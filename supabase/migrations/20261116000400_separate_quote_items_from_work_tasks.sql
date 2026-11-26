-- Los conceptos de repuestos y pintura/materiales son cotización, no actividades ejecutables.
alter table public.work_order_tasks
  add column if not exists is_operational boolean not null default true;

update public.work_order_tasks task
set is_operational = false
from public.estimate_items item
where task.estimate_item_id = item.id
  and item.category in ('parts', 'paint_materials')
  and task.is_operational = true;

-- Este concepto específico de cotización se identificó como material, no como actividad.
update public.work_order_tasks
set is_operational = false
where lower(trim(title)) = 'pintura roja'
  and is_operational = true;

-- Los enlaces de prerequisitos a tareas de materiales no representan trabajo del taller.
delete from public.work_order_task_dependencies dependency
using public.work_order_tasks task
where dependency.task_id = task.id and task.is_operational = false;

delete from public.work_order_task_dependencies dependency
using public.work_order_tasks task
where dependency.prerequisite_task_id = task.id and task.is_operational = false;

create or replace function public.get_client_quote(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'El enlace de seguimiento no es válido.' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'estimate_id', e.id, 'version', e.version,
    'status', case when e.status = 'sent' and e.valid_until < now() then 'expired' else e.status::text end,
    'currency', e.currency, 'notes', e.notes, 'tax_mode', e.tax_mode, 'tax_rate', e.tax_rate,
    'valid_until', e.valid_until, 'order_number', wo.order_number,
    'order_status', wo.status, 'received_at', wo.received_at, 'target_delivery_at', wo.target_delivery_at,
    'customer_name', c.full_name, 'plate', v.plate,
    'vehicle', concat_ws(' ', v.make, v.model, v.model_year),
    'status_history', coalesce((select jsonb_agg(jsonb_build_object('status', h.new_status, 'changed_at', h.changed_at) order by h.changed_at)
      from public.work_order_status_history h where h.work_order_id = wo.id), '[]'::jsonb),
    'task_progress', (select jsonb_build_object('total', count(*), 'completed', count(*) filter (where t.status = 'done'))
      from public.work_order_tasks t where t.work_order_id = wo.id and t.is_operational
        and (t.estimate_item_id is null or t.estimate_item_id in
          (select ei.id from public.estimate_items ei where ei.estimate_id = e.id and ei.decision = 'approved'))),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', ei.id, 'category', ei.category, 'description', ei.description,
      'quantity', ei.quantity, 'unit_price', ei.unit_price, 'decision', ei.decision) order by ei.sort_order, ei.created_at)
      from public.estimate_items ei where ei.estimate_id = e.id), '[]'::jsonb)
  ) into v_quote
  from public.client_portal_tokens t
  join public.estimates e on e.id = t.estimate_id
  join public.work_orders wo on wo.id = e.work_order_id
  join public.customers c on c.id = wo.customer_id
  join public.vehicles v on v.id = wo.vehicle_id
  where t.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null and t.expires_at > now();
  if v_quote is null then raise exception 'El enlace venció o ya no está disponible.' using errcode = 'P0002'; end if;
  return v_quote;
end;
$$;

revoke all on function public.get_client_quote(text) from public;
grant execute on function public.get_client_quote(text) to anon, authenticated;
