import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'No se pudo validar el acceso al taller.' }, 401);
  }

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const accessToken = authorization.replace(/^Bearer\s+/i, '');
  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !authData.user) return json({ error: 'Inicia sesión para continuar.' }, 401);

  const { data: ownerProfile, error: profileError } = await adminClient
    .from('profiles').select('role, active').eq('id', authData.user.id).maybeSingle();
  if (profileError || ownerProfile?.role !== 'owner' || !ownerProfile.active) {
    return json({ error: 'Solo el propietario activo puede invitar personal.' }, 403);
  }

  let body: { action?: string; display_name?: string; email?: string; specialty?: string };
  try { body = await request.json(); } catch { return json({ error: 'Revisa los datos del formulario.' }, 400); }
  if (body.action === 'list') {
    const { data: profiles, error: listError } = await adminClient
      .from('profiles').select('id, display_name, specialty, active').eq('role', 'technician').order('display_name');
    if (listError) return json({ error: 'No se pudo consultar el equipo técnico.' }, 500);
    const emails = new Map<string, string>();
    for (let page = 1; ; page++) {
      const { data: usersPage, error: usersError } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (usersError) return json({ error: 'No se pudieron consultar los correos del equipo.' }, 500);
      for (const user of usersPage.users) if (user.email) emails.set(user.id, user.email);
      if (usersPage.users.length < 1000) break;
    }
    return json({ members: (profiles || []).map(profile => ({ ...profile, email: emails.get(profile.id) || null })) });
  }
  const displayName = String(body.display_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const specialty = String(body.specialty || '');
  if (displayName.length < 2 || displayName.length > 120) return json({ error: 'Escribe el nombre completo del integrante.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Escribe un correo electrónico válido.' }, 400);
  if (!['mechanical', 'bodywork', 'paint'].includes(specialty)) return json({ error: 'Selecciona el oficio principal.' }, 400);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName, role: 'technician', password_setup_required: true },
  });
  if (inviteError || !invited.user) {
    const message = inviteError?.message || 'Supabase Auth no devolvió los datos de la invitación.';
    const normalizedMessage = message.toLowerCase();
    const code = (inviteError as { code?: string } | null)?.code || '';
    if (normalizedMessage.includes('already') || normalizedMessage.includes('registered') || code === 'email_exists') {
      return json({ error: 'Ya existe una cuenta con ese correo en Prisma Motor. Revisa esa cuenta en Supabase o prueba con otro correo.', code: code || 'email_exists' }, 409);
    }
    if (normalizedMessage.includes('not authorized') || code === 'email_address_not_authorized') {
      return json({ error: 'Supabase no autorizó enviar a ese correo. Revisa el SMTP del proyecto y si esa dirección está permitida por el proveedor de correo.', code: code || 'email_address_not_authorized' }, 400);
    }
    if (normalizedMessage.includes('rate limit') || code === 'over_email_send_rate_limit') {
      return json({ error: 'Supabase limitó temporalmente los correos de invitación. Espera un momento y vuelve a intentar.', code: code || 'over_email_send_rate_limit' }, 429);
    }
    console.error('Prisma Motor: Supabase Auth rechazó la invitación.', { code, message });
    return json({ error: `Supabase Auth rechazó la invitación: ${message}`, code: code || 'invite_failed' }, inviteError?.status && inviteError.status >= 400 && inviteError.status < 600 ? inviteError.status : 400);
  }

  const { error: saveError } = await adminClient.from('profiles').upsert({
    id: invited.user.id,
    display_name: displayName,
    role: 'technician',
    specialty,
    active: true,
  }, { onConflict: 'id' });
  if (saveError) {
    await adminClient.auth.admin.deleteUser(invited.user.id);
    return json({ error: 'Supabase creó la invitación, pero no pudo guardar el perfil. Vuelve a intentarlo.' }, 500);
  }
  return json({ ok: true, display_name: displayName, email, specialty });
});
