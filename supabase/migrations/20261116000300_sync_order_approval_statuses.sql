-- Convierte el resultado de la decisión del cliente en el estado real de la orden.
-- También actualiza órdenes existentes que ya recibieron aprobación.
with latest_estimates as (
  select distinct on (e.work_order_id) e.work_order_id, e.status
  from public.estimates e
  order by e.work_order_id, e.version desc
), backfilled_orders as (
  update public.work_orders wo
  set status = case latest.status
    when 'approved' then 'approved'::public.work_order_status
    when 'partially_approved' then 'partially_approved'::public.work_order_status
  end
  from latest_estimates latest
  where latest.work_order_id = wo.id
    and wo.status = 'awaiting_approval'
    and latest.status in ('approved', 'partially_approved')
  returning wo.id, wo.status
)
insert into public.work_order_status_history (work_order_id, previous_status, new_status, note)
select id, 'awaiting_approval'::public.work_order_status, status,
  case status
    when 'approved' then 'Orden actualizada: el cliente aprobó todos los conceptos.'
    else 'Orden actualizada: el cliente aprobó algunos conceptos y rechazó otros.'
  end
from backfilled_orders;

create or replace function public.submit_client_quote_decisions(p_token text, p_decisions jsonb, p_customer_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate_id uuid;
  v_order_id uuid;
  v_estimate_status public.estimate_status;
  v_order_status public.work_order_status;
  v_valid_until timestamptz;
  v_total integer;
  v_approved integer;
  v_rejected integer;
  v_decision record;
  v_new_status public.estimate_status;
  v_new_order_status public.work_order_status;
  v_status_note text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'El enlace de cotización no es válido.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_customer_name)), 0) < 2 then
    raise exception 'Escribe el nombre de quien toma la decisión.' using errcode = '22023';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'Faltan las decisiones para esta cotización.' using errcode = '22023';
  end if;

  select e.id, e.work_order_id, e.status, e.valid_until, wo.status
    into v_estimate_id, v_order_id, v_estimate_status, v_valid_until, v_order_status
  from public.client_portal_tokens t
  join public.estimates e on e.id = t.estimate_id
  join public.work_orders wo on wo.id = e.work_order_id
  where t.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null and t.expires_at > now()
  for update of e, wo;

  if not found then
    raise exception 'El enlace venció o ya no está disponible.' using errcode = 'P0002';
  end if;
  if v_estimate_status <> 'sent' or v_valid_until < now() then
    raise exception 'La vigencia de esta cotización terminó. Contacta al taller para recibir una propuesta actualizada.' using errcode = '22023';
  end if;
  if v_order_status <> 'awaiting_approval' then
    raise exception 'La orden ya no está esperando la decisión del cliente.' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.estimate_items where estimate_id = v_estimate_id;
  if jsonb_array_length(p_decisions) <> v_total
    or (select count(distinct x.item_id) from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text)) <> v_total then
    raise exception 'Debes decidir cada concepto una sola vez.' using errcode = '22023';
  end if;

  for v_decision in select * from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text) loop
    if v_decision.decision is null or v_decision.decision not in ('approved', 'rejected') then
      raise exception 'Cada concepto debe aprobarse o rechazarse.' using errcode = '22023';
    end if;
    update public.estimate_items
    set decision = v_decision.decision::public.item_decision, decided_at = now()
    where id = v_decision.item_id and estimate_id = v_estimate_id;
    if not found then
      raise exception 'La cotización cambió; vuelve a cargar el enlace.' using errcode = '22023';
    end if;
    insert into public.estimate_item_decisions (estimate_item_id, decision, customer_name, source)
    values (v_decision.item_id, v_decision.decision::public.item_decision, trim(p_customer_name), 'client_portal');
  end loop;

  select count(*) filter (where decision = 'approved'),
         count(*) filter (where decision = 'rejected')
    into v_approved, v_rejected
  from public.estimate_items where estimate_id = v_estimate_id;

  v_new_status := case
    when v_approved = 0 then 'rejected'::public.estimate_status
    when v_rejected = 0 then 'approved'::public.estimate_status
    else 'partially_approved'::public.estimate_status
  end;
  update public.estimates set status = v_new_status where id = v_estimate_id;

  if v_new_status = 'rejected' then
    v_new_order_status := 'diagnosis'::public.work_order_status;
    v_status_note := 'El cliente rechazó todos los conceptos; queda pendiente una nueva propuesta.';
  elsif v_new_status = 'approved' then
    v_new_order_status := 'approved'::public.work_order_status;
    v_status_note := 'El cliente aprobó todos los conceptos de la cotización.';
  else
    v_new_order_status := 'partially_approved'::public.work_order_status;
    v_status_note := 'El cliente aprobó algunos conceptos y rechazó otros. Solo se trabajará en los conceptos aprobados.';
  end if;

  update public.work_orders set status = v_new_order_status where id = v_order_id;
  insert into public.work_order_status_history (work_order_id, previous_status, new_status, note)
  values (v_order_id, v_order_status, v_new_order_status, v_status_note);

  return jsonb_build_object('status', v_new_status, 'approved_items', v_approved, 'rejected_items', v_rejected);
end;
$$;

revoke all on function public.submit_client_quote_decisions(text, jsonb, text) from public;
grant execute on function public.submit_client_quote_decisions(text, jsonb, text) to anon, authenticated;
