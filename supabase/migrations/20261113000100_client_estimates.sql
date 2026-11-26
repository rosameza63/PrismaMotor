-- Cotizaciones manuales y aprobación del cliente mediante enlaces privados.
create extension if not exists pgcrypto with schema extensions;

alter table public.estimates
  add column if not exists tax_mode text not null default 'none'
    check (tax_mode in ('included', 'excluded', 'none')),
  add column if not exists tax_rate numeric(5,2) not null default 0
    check (tax_rate between 0 and 100);

alter table public.client_portal_tokens
  add column if not exists estimate_id uuid references public.estimates(id) on delete cascade;

create index if not exists client_portal_tokens_estimate_idx
  on public.client_portal_tokens (estimate_id, expires_at desc)
  where revoked_at is null;

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
  v_previous_status public.work_order_status;
begin
  if (select auth.uid()) is null or public.current_app_role() not in ('owner', 'advisor') then
    raise exception 'Solo recepción y propietario pueden enviar cotizaciones.' using errcode = '42501';
  end if;
  if p_validity_days < 1 or p_validity_days > 30 then
    raise exception 'La vigencia debe estar entre 1 y 30 días.' using errcode = '22023';
  end if;

  select e.work_order_id, e.status, wo.status
    into v_order_id, v_estimate_status, v_order_status
    from public.estimates e
    join public.work_orders wo on wo.id = e.work_order_id
   where e.id = p_estimate_id
   for update of e, wo;
  if not found then raise exception 'No se encontró la cotización.' using errcode = 'P0002'; end if;
  if v_estimate_status not in ('draft', 'sent') then raise exception 'Esta cotización ya recibió una decisión y no se puede reenviar.' using errcode = '22023'; end if;
  if v_order_status not in ('diagnosis', 'awaiting_approval') then
    raise exception 'La orden debe estar en diagnóstico antes de enviar una cotización.' using errcode = '22023';
  end if;
  select count(*) into v_item_count from public.estimate_items where estimate_id = p_estimate_id;
  if v_item_count = 0 then raise exception 'Agrega al menos un concepto antes de enviar la cotización.' using errcode = '22023'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.client_portal_tokens set revoked_at = now()
   where work_order_id = v_order_id and revoked_at is null;
  update public.estimates set status = 'expired'
   where work_order_id = v_order_id and id <> p_estimate_id and status = 'sent';
  update public.estimates
     set status = 'sent', sent_at = now(), valid_until = now() + make_interval(days => p_validity_days)
   where id = p_estimate_id;
  insert into public.client_portal_tokens (work_order_id, estimate_id, token_hash, expires_at)
  values (v_order_id, p_estimate_id,
          encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
          now() + make_interval(days => p_validity_days));

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
    raise exception 'El enlace de cotización no es válido.' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'estimate_id', e.id,
    'version', e.version,
    'status', e.status,
    'currency', e.currency,
    'notes', e.notes,
    'tax_mode', e.tax_mode,
    'tax_rate', e.tax_rate,
    'valid_until', e.valid_until,
    'order_number', wo.order_number,
    'customer_name', c.full_name,
    'plate', v.plate,
    'vehicle', concat_ws(' ', v.make, v.model, v.model_year),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ei.id, 'category', ei.category, 'description', ei.description,
        'quantity', ei.quantity, 'unit_price', ei.unit_price, 'decision', ei.decision
      ) order by ei.sort_order, ei.created_at)
      from public.estimate_items ei where ei.estimate_id = e.id
    ), '[]'::jsonb)
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
  v_total integer;
  v_approved integer;
  v_rejected integer;
  v_decision record;
  v_new_status public.estimate_status;
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

  select e.id, e.work_order_id, e.status into v_estimate_id, v_order_id, v_estimate_status
  from public.client_portal_tokens t
  join public.estimates e on e.id = t.estimate_id
  where t.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null and t.expires_at > now()
  for update of e;
  if not found then raise exception 'El enlace venció o ya no está disponible.' using errcode = 'P0002'; end if;
  if v_estimate_status <> 'sent' then raise exception 'Esta cotización ya recibió una decisión.' using errcode = '22023'; end if;

  select count(*) into v_total from public.estimate_items where estimate_id = v_estimate_id;
  if jsonb_array_length(p_decisions) <> v_total
     or (select count(distinct x.item_id) from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text)) <> v_total then
    raise exception 'Debes decidir cada concepto una sola vez.' using errcode = '22023';
  end if;

  for v_decision in select * from jsonb_to_recordset(p_decisions) as x(item_id uuid, decision text)
  loop
    if v_decision.decision is null or v_decision.decision not in ('approved', 'rejected') then
      raise exception 'Cada concepto debe aprobarse o rechazarse.' using errcode = '22023';
    end if;
    update public.estimate_items
       set decision = v_decision.decision::public.item_decision, decided_at = now()
     where id = v_decision.item_id and estimate_id = v_estimate_id;
    if not found then raise exception 'La cotización cambió; vuelve a cargar el enlace.' using errcode = '22023'; end if;
    insert into public.estimate_item_decisions (estimate_item_id, decision, customer_name, source)
    values (v_decision.item_id, v_decision.decision::public.item_decision, trim(p_customer_name), 'client_portal');
  end loop;

  select count(*) filter (where decision = 'approved'), count(*) filter (where decision = 'rejected')
    into v_approved, v_rejected from public.estimate_items where estimate_id = v_estimate_id;
  v_new_status := case when v_approved = 0 then 'rejected'::public.estimate_status
                       when v_rejected = 0 then 'approved'::public.estimate_status
                       else 'partially_approved'::public.estimate_status end;
  update public.estimates set status = v_new_status where id = v_estimate_id;

  if v_new_status = 'rejected' then
    update public.work_orders set status = 'diagnosis' where id = v_order_id and status = 'awaiting_approval';
    if found then
      insert into public.work_order_status_history (work_order_id, previous_status, new_status, note)
      values (v_order_id, 'awaiting_approval', 'diagnosis', 'El cliente rechazó la cotización; queda pendiente una nueva propuesta.');
    end if;
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
grant usage on schema public to anon;
