-- Borrado completo de una orden desde la sesión del propietario.
-- Se elimina el consumo ligado a la orden y se devuelve esa cantidad al saldo actual.
create or replace function public.delete_work_order_bundle(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_order_number bigint;
  v_object_paths jsonb;
  v_vehicle_deleted boolean := false;
  v_customer_deleted boolean := false;
  v_restored_products integer := 0;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'owner'::public.app_role then
    raise exception 'Solo el propietario puede eliminar una orden.' using errcode = '42501';
  end if;

  select wo.customer_id, wo.vehicle_id, wo.order_number
    into v_customer_id, v_vehicle_id, v_order_number
  from public.work_orders as wo
  where wo.id = p_work_order_id
  for update;
  if not found then
    raise exception 'La orden ya no existe o ya fue eliminada.' using errcode = 'P0002';
  end if;

  -- Bloquear los registros padre antes de decidir si pueden eliminarse por completo.
  perform 1 from public.customers where id = v_customer_id for update;
  perform 1 from public.vehicles where id = v_vehicle_id for update;

  select coalesce(jsonb_agg(media.object_path), '[]'::jsonb)
    into v_object_paths
  from public.work_order_media as media
  where media.work_order_id = p_work_order_id;

  -- El consumo se borra con la orden; devolver esas unidades al saldo vigente.
  update public.inventory_products as product
  set stock_quantity = coalesce(product.stock_quantity, 0) + consumed.quantity
  from (
    select movement.product_id, sum(abs(movement.quantity_change)) as quantity
    from public.inventory_movements as movement
    where movement.work_order_id = p_work_order_id
      and movement.movement_type = 'consumption'
    group by movement.product_id
  ) as consumed
  where product.id = consumed.product_id;
  get diagnostics v_restored_products = row_count;

  delete from public.inventory_movements where work_order_id = p_work_order_id;
  delete from public.work_order_payments where work_order_id = p_work_order_id;
  delete from public.estimate_item_decisions as decision
  using public.estimate_items as item, public.estimates as estimate
  where decision.estimate_item_id = item.id
    and item.estimate_id = estimate.id
    and estimate.work_order_id = p_work_order_id;

  -- Los datos de recepción, fotos vinculadas, tareas, cotizaciones, tokens,
  -- dependencias e historial se eliminan por las relaciones ON DELETE CASCADE.
  delete from public.work_orders where id = p_work_order_id;

  -- Un vehículo/cliente compartido por otras órdenes se conserva.
  delete from public.vehicles as vehicle
  where vehicle.id = v_vehicle_id
    and not exists (select 1 from public.work_orders as other_order where other_order.vehicle_id = vehicle.id)
  returning true into v_vehicle_deleted;
  v_vehicle_deleted := coalesce(v_vehicle_deleted, false);

  if v_vehicle_deleted then
    delete from public.customers as customer
    where customer.id = v_customer_id
      and not exists (select 1 from public.vehicles as other_vehicle where other_vehicle.customer_id = customer.id)
      and not exists (select 1 from public.work_orders as other_order where other_order.customer_id = customer.id)
    returning true into v_customer_deleted;
    v_customer_deleted := coalesce(v_customer_deleted, false);
  end if;

  return jsonb_build_object(
    'order_number', v_order_number,
    'object_paths', v_object_paths,
    'vehicle_deleted', v_vehicle_deleted,
    'customer_deleted', v_customer_deleted,
    'restored_products', v_restored_products
  );
end;
$$;

revoke all on function public.delete_work_order_bundle(uuid) from public, anon;
grant execute on function public.delete_work_order_bundle(uuid) to authenticated;
