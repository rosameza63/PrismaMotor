-- Pagos, tarifas de mano de obra y costo por concepto para el tablero del propietario.

create table public.work_order_payments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'transfer', 'card', 'other')),
  paid_at timestamptz not null default now(),
  reference text check (reference is null or length(reference) <= 200),
  received_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index work_order_payments_paid_at_idx on public.work_order_payments (paid_at desc);
create index work_order_payments_order_idx on public.work_order_payments (work_order_id, paid_at desc);
alter table public.work_order_payments enable row level security;
revoke all on table public.work_order_payments from anon, authenticated;
grant select, insert on public.work_order_payments to authenticated;
grant all on public.work_order_payments to service_role;
create policy "owner manages work order payments" on public.work_order_payments for all to authenticated
  using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

create table public.labor_cost_rates (
  work_type text primary key check (work_type in ('mechanical', 'bodywork', 'paint', 'assembly', 'quality_control', 'other')),
  hourly_cost numeric(12,2) not null default 0 check (hourly_cost >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.labor_cost_rates(work_type, hourly_cost) values
  ('mechanical', 0), ('bodywork', 0), ('paint', 0), ('assembly', 0), ('quality_control', 0), ('other', 0)
on conflict (work_type) do nothing;
alter table public.labor_cost_rates enable row level security;
revoke all on table public.labor_cost_rates from anon, authenticated;
grant select, insert, update on public.labor_cost_rates to authenticated;
grant all on public.labor_cost_rates to service_role;
create policy "owner manages labor cost rates" on public.labor_cost_rates for all to authenticated
  using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

alter table public.inventory_movements
  add column estimate_item_id uuid references public.estimate_items(id) on delete set null;
create index inventory_movements_estimate_item_idx on public.inventory_movements (estimate_item_id)
  where estimate_item_id is not null;

create or replace function public.validate_inventory_movement_estimate_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_item_order uuid;
  v_item_decision public.item_decision;
begin
  if new.estimate_item_id is null then return new; end if;
  if new.movement_type <> 'consumption' or new.work_order_id is null then
    raise exception 'Un concepto de cotización solo puede asociarse a un consumo de una orden.' using errcode = '22023';
  end if;
  select e.work_order_id, i.decision into v_item_order, v_item_decision
  from public.estimate_items i join public.estimates e on e.id = i.estimate_id
  where i.id = new.estimate_item_id;
  if v_item_order is distinct from new.work_order_id then
    raise exception 'El concepto seleccionado no pertenece a esta orden.' using errcode = '22023';
  end if;
  if v_item_decision <> 'approved' then
    raise exception 'El consumo solo se puede asociar a un concepto aprobado por el cliente.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger inventory_movement_estimate_item_guard
  before insert or update of estimate_item_id, work_order_id, movement_type on public.inventory_movements
  for each row execute function public.validate_inventory_movement_estimate_item();

-- Reemplaza la función previa para poder atribuir un consumo al concepto cotizado.
drop function public.record_inventory_movement(uuid, text, numeric, numeric, uuid, text);
create function public.record_inventory_movement(
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_work_order_id uuid default null,
  p_note text default null,
  p_estimate_item_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_product public.inventory_products%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_delta numeric(12,2);
  v_old_stock numeric(12,2);
  v_new_stock numeric(12,2);
  v_cost numeric(14,2);
  v_movement_cost numeric(14,2);
begin
  if public.current_app_role() not in ('owner', 'advisor') then
    raise exception 'Solo el propietario o recepción pueden registrar movimientos.' using errcode = '42501';
  end if;
  if p_movement_type is null or p_movement_type not in ('purchase', 'consumption', 'adjustment') then
    raise exception 'Tipo de movimiento no válido.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'La cantidad debe ser distinta de cero.' using errcode = '22023'; end if;
  if p_movement_type in ('purchase', 'consumption') and p_quantity < 0 then
    raise exception 'Escribe una cantidad positiva para la compra o el consumo.' using errcode = '22023';
  end if;
  if p_movement_type = 'purchase' and (p_unit_cost is null or p_unit_cost < 0) then
    raise exception 'Indica el costo unitario de compra.' using errcode = '22023';
  end if;
  if p_movement_type = 'consumption' and p_work_order_id is null then raise exception 'Asocia el consumo con una orden de trabajo.' using errcode = '22023'; end if;
  if p_movement_type <> 'consumption' and (p_work_order_id is not null or p_estimate_item_id is not null) then
    raise exception 'Solo los consumos se asocian a una orden y concepto.' using errcode = '22023';
  end if;
  select * into v_product from public.inventory_products where id = p_product_id for update;
  if not found then raise exception 'El producto no existe.' using errcode = 'P0002'; end if;
  v_old_stock := coalesce(v_product.stock_quantity, 0);
  v_cost := coalesce(v_product.cost_price, 0);
  v_movement_cost := v_cost;
  if p_movement_type = 'purchase' then
    v_delta := p_quantity; v_movement_cost := p_unit_cost;
  elsif p_movement_type = 'consumption' then
    if v_product.stock_quantity is null then raise exception 'Registra primero las existencias actuales con un ajuste positivo.' using errcode = '22023'; end if;
    if v_product.stock_quantity < p_quantity then raise exception 'Existencias insuficientes. Disponible: %.', v_product.stock_quantity using errcode = '22023'; end if;
    v_delta := -p_quantity;
  else
    v_delta := p_quantity;
    if v_product.stock_quantity is null and v_delta < 0 then raise exception 'El inventario aún no tiene saldo. Registra primero un ajuste inicial positivo.' using errcode = '22023'; end if;
  end if;
  v_new_stock := v_old_stock + v_delta;
  if v_new_stock < 0 then raise exception 'El saldo del producto no puede quedar negativo.' using errcode = '22023'; end if;
  if p_movement_type = 'purchase' and v_new_stock > 0 then
    v_cost := ((v_old_stock * coalesce(v_product.cost_price, 0)) + (p_quantity * p_unit_cost)) / v_new_stock;
  end if;
  update public.inventory_products set stock_quantity = v_new_stock, cost_price = v_cost where id = p_product_id;
  insert into public.inventory_movements(product_id, movement_type, quantity_change, unit_cost, work_order_id, estimate_item_id, note, created_by)
  values (p_product_id, p_movement_type, case when p_movement_type = 'adjustment' then p_quantity else -p_quantity end,
    v_movement_cost, p_work_order_id, p_estimate_item_id, nullif(trim(p_note), ''), auth.uid()) returning * into v_movement;
  return jsonb_build_object('id', v_movement.id, 'stock_quantity', v_new_stock, 'unit_cost', v_cost, 'total_cost', v_movement.total_cost);
end;
$$;
revoke all on function public.record_inventory_movement(uuid, text, numeric, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.record_inventory_movement(uuid, text, numeric, numeric, uuid, text, uuid) to authenticated;

create or replace function public.record_work_order_payment(
  p_work_order_id uuid, p_amount numeric, p_payment_method text, p_paid_at timestamptz default now(), p_reference text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_payment_id uuid;
begin
  if public.current_app_role() <> 'owner' then raise exception 'Solo el propietario puede registrar pagos.' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El valor del pago debe ser mayor que cero.' using errcode = '22023'; end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'other') then raise exception 'Selecciona un medio de pago válido.' using errcode = '22023'; end if;
  insert into public.work_order_payments(work_order_id, amount, payment_method, paid_at, reference, received_by)
  values (p_work_order_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), nullif(trim(p_reference), ''), auth.uid())
  returning id into v_payment_id;
  return v_payment_id;
end;
$$;
revoke all on function public.record_work_order_payment(uuid, numeric, text, timestamptz, text) from public, anon;
grant execute on function public.record_work_order_payment(uuid, numeric, text, timestamptz, text) to authenticated;

