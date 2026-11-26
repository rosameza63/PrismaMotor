-- Corrige el signo de quantity_change al registrar compras.
-- La función previa calculaba v_delta con el signo correcto para actualizar
-- existencias, pero insertaba -p_quantity para las compras y violaba el CHECK.
create or replace function public.record_inventory_movement(
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
  if p_quantity is null or p_quantity = 0 then
    raise exception 'La cantidad debe ser distinta de cero.' using errcode = '22023';
  end if;
  if p_movement_type in ('purchase', 'consumption') and p_quantity < 0 then
    raise exception 'Escribe una cantidad positiva para la compra o el consumo.' using errcode = '22023';
  end if;
  if p_movement_type = 'purchase' and (p_unit_cost is null or p_unit_cost < 0) then
    raise exception 'Indica el costo unitario de compra.' using errcode = '22023';
  end if;
  if p_movement_type = 'consumption' and p_work_order_id is null then
    raise exception 'Asocia el consumo con una orden de trabajo.' using errcode = '22023';
  end if;
  if p_movement_type <> 'consumption' and (p_work_order_id is not null or p_estimate_item_id is not null) then
    raise exception 'Solo los consumos se asocian a una orden y concepto.' using errcode = '22023';
  end if;

  select * into v_product
  from public.inventory_products
  where id = p_product_id
  for update;
  if not found then raise exception 'El producto no existe.' using errcode = 'P0002'; end if;

  v_old_stock := coalesce(v_product.stock_quantity, 0);
  v_cost := coalesce(v_product.cost_price, 0);
  v_movement_cost := v_cost;
  if p_movement_type = 'purchase' then
    v_delta := p_quantity;
    v_movement_cost := p_unit_cost;
  elsif p_movement_type = 'consumption' then
    if v_product.stock_quantity is null then
      raise exception 'Registra primero las existencias actuales con un ajuste positivo.' using errcode = '22023';
    end if;
    if v_product.stock_quantity < p_quantity then
      raise exception 'Existencias insuficientes. Disponible: %.', v_product.stock_quantity using errcode = '22023';
    end if;
    v_delta := -p_quantity;
  else
    v_delta := p_quantity;
    if v_product.stock_quantity is null and v_delta < 0 then
      raise exception 'El inventario aún no tiene saldo. Registra primero un ajuste inicial positivo.' using errcode = '22023';
    end if;
  end if;

  v_new_stock := v_old_stock + v_delta;
  if v_new_stock < 0 then raise exception 'El saldo del producto no puede quedar negativo.' using errcode = '22023'; end if;
  if p_movement_type = 'purchase' and v_new_stock > 0 then
    v_cost := ((v_old_stock * coalesce(v_product.cost_price, 0)) + (p_quantity * p_unit_cost)) / v_new_stock;
  end if;

  update public.inventory_products
  set stock_quantity = v_new_stock, cost_price = v_cost
  where id = p_product_id;

  insert into public.inventory_movements(product_id, movement_type, quantity_change, unit_cost, work_order_id, estimate_item_id, note, created_by)
  values (p_product_id, p_movement_type, v_delta, v_movement_cost, p_work_order_id, p_estimate_item_id,
    nullif(trim(p_note), ''), auth.uid())
  returning * into v_movement;

  return jsonb_build_object('id', v_movement.id, 'stock_quantity', v_new_stock, 'unit_cost', v_cost, 'total_cost', v_movement.total_cost);
end;
$$;

revoke all on function public.record_inventory_movement(uuid, text, numeric, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.record_inventory_movement(uuid, text, numeric, numeric, uuid, text, uuid) to authenticated;
