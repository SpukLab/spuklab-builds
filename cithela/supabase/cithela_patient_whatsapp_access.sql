-- CITHELA WhatsApp-first patient access.
-- Backwards-compatible with existing verified-email invitations.

alter table public.cithela_patient_invites
  add column if not exists target_phone text;

alter table public.cithela_patient_invites
  alter column target_email drop not null;

alter table public.cithela_patient_invites
  drop constraint if exists cithela_patient_invites_target_identity_check;

alter table public.cithela_patient_invites
  add constraint cithela_patient_invites_target_identity_check
  check (
    (target_email is not null and target_phone is null)
    or
    (target_email is null and target_phone is not null)
  );

alter table public.cithela_patient_invites
  drop constraint if exists cithela_patient_invites_target_phone_format_check;

alter table public.cithela_patient_invites
  add constraint cithela_patient_invites_target_phone_format_check
  check (target_phone is null or target_phone ~ '^\+[1-9][0-9]{7,14}$');

create or replace function cithela_private.patient_invite_issue_phone(
  p_tenant_id uuid, p_person_id uuid, p_phone text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_phone text := btrim(coalesce(p_phone,''));
  v_token text;
  v_exp timestamptz := now() + interval '48 hours';
  v_invite_id uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok',false,'code','unauthenticated');
  end if;

  select m.role into v_role
  from public.cithela_tenant_memberships m
  where m.tenant_id=p_tenant_id and m.user_id=v_actor;

  if v_role is null or v_role not in ('owner','admin','operator') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;

  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'code','invalid_phone');
  end if;

  perform 1 from public.cithela_tenants t
  where t.id=p_tenant_id and t.status='active' for update;
  if not found then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;

  perform 1 from public.cithela_people p
  where p.tenant_id=p_tenant_id and p.id=p_person_id;
  if not found then
    return jsonb_build_object('ok',false,'code','person_not_found');
  end if;

  perform 1 from public.cithela_people p
  where p.tenant_id=p_tenant_id and p.id=p_person_id and p.phone_e164=v_phone;
  if not found then
    return jsonb_build_object('ok',false,'code','phone_mismatch');
  end if;

  if exists (
    select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.person_id=p_person_id
  ) then
    return jsonb_build_object('ok',false,'code','already_linked');
  end if;

  if (
    select count(*) from public.cithela_patient_invites i
    where i.tenant_id=p_tenant_id and i.person_id=p_person_id
      and i.created_at>now()-interval '1 hour'
  ) >= 5 then
    return jsonb_build_object('ok',false,'code','rate_limited');
  end if;

  update public.cithela_patient_invites i
  set revoked_at=now()
  where i.tenant_id=p_tenant_id and i.person_id=p_person_id
    and i.redeemed_at is null and i.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(24),'hex');

  insert into public.cithela_patient_invites
    (tenant_id,person_id,target_email,target_phone,token_hash,issued_by,expires_at)
  values
    (p_tenant_id,p_person_id,null,v_phone,
      extensions.digest(decode(v_token,'hex'),'sha256'),v_actor,v_exp)
  returning id into v_invite_id;

  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values
    (p_tenant_id,v_actor,'patient_invite_issued','patient',p_person_id,
      jsonb_build_object(
        'invite_id',v_invite_id,
        'expires_at',v_exp,
        'channel','whatsapp'
      ));

  return jsonb_build_object(
    'ok',true,
    'code','invite_issued',
    'invite_code',v_token,
    'phone',v_phone,
    'expires_at',v_exp
  );
end
$fn$;

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
    if v_inv.target_phone is distinct from v_user_phone then
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

create or replace function public.cithela_patient_invite_issue_phone(
  p_tenant_id uuid,p_person_id uuid,p_phone text
) returns jsonb
language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_invite_issue_phone(p_tenant_id,p_person_id,p_phone);
$fn$;

revoke all on function cithela_private.patient_invite_issue_phone(uuid,uuid,text) from public,anon;
grant execute on function cithela_private.patient_invite_issue_phone(uuid,uuid,text) to authenticated;
revoke all on function public.cithela_patient_invite_issue_phone(uuid,uuid,text) from public,anon;
grant execute on function public.cithela_patient_invite_issue_phone(uuid,uuid,text) to authenticated;
