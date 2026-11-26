-- Catalogo inicial de repuestos e insumos. El stock se informa, pero no se descuenta
-- al cotizar ni al aprobar; los movimientos reales se agregaran en una fase posterior.
create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null check (length(trim(name)) between 2 and 160),
  category text not null check (category in ('parts', 'paint_materials')),
  unit text not null default 'unidad' check (unit in ('unidad', 'juego', 'litro', 'galon', 'mililitro', 'kilogramo', 'gramo', 'metro', 'servicio')),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  stock_quantity numeric(12,2) check (stock_quantity is null or stock_quantity >= 0),
  minimum_stock numeric(12,2) check (minimum_stock is null or minimum_stock >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_products_active_name_idx on public.inventory_products (active, name);
create trigger inventory_products_set_updated_at before update on public.inventory_products
  for each row execute function public.set_updated_at();

alter table public.inventory_products enable row level security;
revoke all on table public.inventory_products from anon, authenticated;
grant select, insert, update, delete on table public.inventory_products to authenticated;
grant all on table public.inventory_products to service_role;
create policy "inventory_products_management_all" on public.inventory_products for all to authenticated
  using (public.current_app_role() in ('owner', 'advisor'))
  with check (public.current_app_role() in ('owner', 'advisor'));

alter table public.estimate_items
  add column inventory_product_id uuid references public.inventory_products(id) on delete set null;
create index estimate_items_inventory_product_idx on public.estimate_items (inventory_product_id);
