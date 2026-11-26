-- Mantiene el enlace privado disponible para seguimiento tras aprobar la cotizacion.
create or replace function public.send_client_quote(p_estimate_id uuid, p_validity_days integer default 7)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_estimate_status public.estimate_status;
  v_order_status public.work_order_status;
  v_item_count integer;
  v_token text;
begin
  if (select auth.uid()) is null or public.current_app_role() not in ('owner', 'advisor') then
    raise exception 'Solo recepción y propietario pueden enviar cotizaciones.' using errcode = '42501';
  end if;
  if p_validity_days < 1 or p_validity_days > 30 then
    raise exception 'La vigencia debe estar entre 1 y 30 días.' using errcode = '22023';
  end if;
  select e.work_order_id, e.status, wo.status into v_order_id, v_estimate_status, v_order_status
    from public.estimates e join public.work_orders wo on wo.id = e.work_order_id
   where e.id = p_estimate_id for update of e, wo;
  if not found then raise exception 'No se encontró la cotización.' using errcode = 'P0002'; end if;
  if v_estimate_status not in ('draft', 'sent') then raise exception 'Esta cotización ya recibió una decisión y no se puede reenviar.' using errcode = '22023'; end if;
  if v_order_status not in ('diagnosis', 'awaiting_approval') then raise exception 'La orden debe estar en diagnóstico antes de enviar una cotización.' using errcode = '22023'; end if;
  select count(*) into v_item_count from public.estimate_items where estimate_id = p_estimate_id;
  if v_item_count = 0 then raise exception 'Agrega al menos un concepto antes de enviar la cotización.' using errcode = '22023'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.client_portal_tokens set revoked_at = now() where work_order_id = v_order_id and revoked_at is null;
  update public.estimates set status = 'expired' where work_order_id = v_order_id and id <> p_estimate_id and status = 'sent';
  update public.estimates set status = 'sent', sent_at = now(), valid_until = now() + make_interval(days => p_validity_days) where id = p_estimate_id;
  insert into public.client_portal_tokens (work_order_id, estimate_id, token_hash, expires_at)
  values (v_order_id, p_estimate_id, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), now() + interval '180 days');
  if v_order_status = 'diagnosis' then
    update public.work_orders set status = 'awaiting_approval' where id = v_order_id;
    insert into public.work_order_status_history (work_order_id, previous_status, new_status, note, changed_by)
    values (v_order_id, v_order_status, 'awaiting_approval', 'Se envió una cotización al cliente.', (select auth.uid()));
  end if;
  return v_token;
end;
$$;

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
      from public.work_order_tasks t where t.work_order_id = wo.id and t.estimate_item_id in
        (select ei.id from public.estimate_items ei where ei.estimate_id = e.id and ei.decision = 'approved')),
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
  v_valid_until timestamptz;
  v_total integer;
  v_approved integer;
  v_rejected integer;
  v_decision record;
  v_new_status public.estimate_status;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'El enlace de cotización no es válido.' using errcode = '22023'; end if;
  if coalesce(length(trim(p_customer_name)), 0) < 2 then raise exception 'Escribe el nombre de quien toma la decisión.' using errcode = '22023'; end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then raise exception 'Faltan las decisiones para esta cotización.' using errcode = '22023'; end if;
  select e.id, e.work_order_id, e.status, e.valid_until into v_estimate_id, v_order_id, v_estimate_status, v_valid_until
  from public.client_portal_tokens t join public.estimates e on e.id = t.estimate_id
  where t.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex') and t.revoked_at is null and t.expires_at > now()
  for update of e;
  if not found then raise exception 'El enlace venció o ya no está disponible.' using errcode = 'P0002'; end if;
  if v_estimate_status <> 'sent' or v_valid_until < now() then raise exception 'La vigencia de esta cotización terminó. Contacta al taller para recibir una propuesta actualizada.' using errcode = '22023'; end if;
  select count(*) into v_total from public.estimate_items where estimate_id = v_estimate_id;
  if jsonb_array_length(p_decisions) <> v_total or (select count(distinct x.item_id) from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text)) <> v_total then
    raise exception 'Debes decidir cada concepto una sola vez.' using errcode = '22023';
  end if;
  for v_decision in select * from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text) loop
    if v_decision.decision is null or v_decision.decision not in ('approved', 'rejected') then raise exception 'Cada concepto debe aprobarse o rechazarse.' using errcode = '22023'; end if;
    update public.estimate_items set decision = v_decision.decision::public.item_decision, decided_at = now() where id = v_decision.item_id and estimate_id = v_estimate_id;
    if not found then raise exception 'La cotización cambió; vuelve a cargar el enlace.' using errcode = '22023'; end if;
    insert into public.estimate_item_decisions (estimate_item_id, decision, customer_name, source)
    values (v_decision.item_id, v_decision.decision::public.item_decision, trim(p_customer_name), 'client_portal');
  end loop;
  select count(*) filter (where decision = 'approved'), count(*) filter (where decision = 'rejected') into v_approved, v_rejected
    from public.estimate_items where estimate_id = v_estimate_id;
  v_new_status := case when v_approved = 0 then 'rejected'::public.estimate_status when v_rejected = 0 then 'approved'::public.estimate_status else 'partially_approved'::public.estimate_status end;
  update public.estimates set status = v_new_status where id = v_estimate_id;
  if v_new_status = 'rejected' then
    update public.work_orders set status = 'diagnosis' where id = v_order_id and status = 'awaiting_approval';
    if found then insert into public.work_order_status_history (work_order_id, previous_status, new_status, note)
      values (v_order_id, 'awaiting_approval', 'diagnosis', 'El cliente rechazó la cotización; queda pendiente una nueva propuesta.'); end if;
  end if;
  return jsonb_build_object('status', v_new_status, 'approved_items', v_approved, 'rejected_items', v_rejected);
end;
$$;

revoke all on function public.send_client_quote(uuid, integer) from public, anon;
revoke all on function public.get_client_quote(text) from public;
revoke all on function public.submit_client_quote_decisions(text, jsonb, text) from public;
grant execute on function public.send_client_quote(uuid, integer) to authenticated;
grant execute on function public.get_client_quote(text) to anon, authenticated;
grant execute on function public.submit_client_quote_decisions(text, jsonb, text) to anon, authenticated;
