-- CITHELA: normalize only leading '+' in verified full phone comparisons.
-- Supabase Auth stores phone without '+', while invitations use E.164 with '+'.
-- Security invariants: authenticated actor, verified phone, identical full
-- international digits, one-use/expiry, tenant link ownership and audit stay intact.

create or replace function cithela_private.patient_invite_redeem(
  p_invite_code text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_user_email text;
  v_email_confirmed timestamptz;
  v_user_phone text;
  v_phone_confirmed timestamptz;
  v_code text := lower(btrim(coalesce(p_invite_code,'')));
  v_inv public.cithela_patient_invites%rowtype;
  v_existing uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok',false,'code','unauthenticated');
  end if;

  select lower(btrim(u.email)),u.email_confirmed_at,btrim(u.phone),u.phone_confirmed_at
  into v_user_email,v_email_confirmed,v_user_phone,v_phone_confirmed
  from auth.users u
  where u.id=v_actor;

  if v_code !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok',false,'code','invalid_invite');
  end if;

  select i.* into v_inv
  from public.cithela_patient_invites i
  where i.token_hash=extensions.digest(decode(v_code,'hex'),'sha256')
  for update;

  if not found
    or v_inv.expires_at<=now()
    or v_inv.revoked_at is not null
    or v_inv.redeemed_at is not null then
    return jsonb_build_object('ok',false,'code','invalid_invite');
  end if;

  if v_inv.target_phone is not null then
    if v_phone_confirmed is null then
      return jsonb_build_object('ok',false,'code','phone_not_verified');
    end if;
    if ltrim(v_inv.target_phone,'+') is distinct from ltrim(v_user_phone,'+') then
      return jsonb_build_object('ok',false,'code','invalid_invite');
    end if;
  elsif v_inv.target_email is not null then
    if v_email_confirmed is null then
      return jsonb_build_object('ok',false,'code','email_not_verified');
    end if;
    if v_inv.target_email is distinct from v_user_email then
      return jsonb_build_object('ok',false,'code','invalid_invite');
    end if;
  else
    return jsonb_build_object('ok',false,'code','invalid_invite');
  end if;

  select l.user_id into v_existing
  from public.cithela_patient_links l
  where l.tenant_id=v_inv.tenant_id and l.person_id=v_inv.person_id
  for update;

  if v_existing is not null and v_existing<>v_actor then
    return jsonb_build_object('ok',false,'code','already_linked');
  end if;

  if v_existing is null then
    insert into public.cithela_patient_links(tenant_id,person_id,user_id)
    values(v_inv.tenant_id,v_inv.person_id,v_actor);
  end if;

  update public.cithela_patient_invites
  set redeemed_by=v_actor,redeemed_at=now()
  where id=v_inv.id;

  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values
    (v_inv.tenant_id,v_actor,'patient_invite_redeemed','patient',v_inv.person_id,
      jsonb_build_object(
        'invite_id',v_inv.id,
        'channel',case when v_inv.target_phone is not null then 'whatsapp' else 'email' end
      ));

  return jsonb_build_object('ok',true,'code','patient_linked');
end
$fn$;
