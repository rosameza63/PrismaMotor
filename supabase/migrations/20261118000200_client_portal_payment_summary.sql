-- Expone al portal público, por enlace privado, solo el importe, medio y fecha
-- de los pagos asociados a esa orden. No comparte referencias ni usuarios internos.
create or replace function public.get_client_quote(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
  v_order_id uuid;
  v_payment_summary jsonb := null;
  v_payments jsonb := '[]'::jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'El enlace de seguimiento no es válido.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'estimate_id', e.id,
    'version', e.version,
    'status', case when e.status = 'sent' and e.valid_until < now() then 'expired' else e.status::text end,
    'currency', e.currency,
    'notes', e.notes,
    'tax_mode', e.tax_mode,
    'tax_rate', e.tax_rate,
    'valid_until', e.valid_until,
    'order_number', wo.order_number,
    'order_status', wo.status,
    'received_at', wo.received_at,
    'target_delivery_at', wo.target_delivery_at,
    'customer_name', c.full_name,
    'plate', v.plate,
    'vehicle', concat_ws(' ', v.make, v.model, v.model_year),
    'status_history', coalesce((
      select jsonb_agg(jsonb_build_object('status', h.new_status, 'changed_at', h.changed_at) order by h.changed_at)
      from public.work_order_status_history h where h.work_order_id = wo.id
    ), '[]'::jsonb),
    'task_progress', (
      select jsonb_build_object('total', count(*), 'completed', count(*) filter (where t.status = 'done'))
      from public.work_order_tasks t
      where t.work_order_id = wo.id and t.is_operational
        and (t.estimate_item_id is null or t.estimate_item_id in (
          select ei.id from public.estimate_items ei
          where ei.estimate_id = e.id and ei.decision = 'approved'
        ))
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ei.id, 'category', ei.category, 'description', ei.description,
        'quantity', ei.quantity, 'unit_price', ei.unit_price, 'decision', ei.decision
      ) order by ei.sort_order, ei.created_at)
      from public.estimate_items ei where ei.estimate_id = e.id
    ), '[]'::jsonb)
  ), wo.id
  into v_quote, v_order_id
  from public.client_portal_tokens t
  join public.estimates e on e.id = t.estimate_id
  join public.work_orders wo on wo.id = e.work_order_id
  join public.customers c on c.id = wo.customer_id
  join public.vehicles v on v.id = wo.vehicle_id
  where t.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null and t.expires_at > now();

  if v_quote is null then
    raise exception 'El enlace venció o ya no está disponible.' using errcode = 'P0002';
  end if;

  -- Se consulta dinámicamente para conservar compatibilidad si el módulo de pagos
  -- aún no está instalado en una base de datos de desarrollo.
  if to_regclass('public.work_order_payments') is not null then
    execute $query$
      select jsonb_build_object('paid_amount', coalesce(sum(amount), 0)),
        coalesce(jsonb_agg(jsonb_build_object(
          'amount', amount, 'payment_method', payment_method, 'paid_at', paid_at
        ) order by paid_at desc), '[]'::jsonb)
      from public.work_order_payments where work_order_id = $1
    $query$
    into v_payment_summary, v_payments
    using v_order_id;
  end if;

  return v_quote || jsonb_build_object('payment_summary', v_payment_summary, 'payments', v_payments);
end;
$$;

revoke all on function public.get_client_quote(text) from public;
grant execute on function public.get_client_quote(text) to anon, authenticated;
