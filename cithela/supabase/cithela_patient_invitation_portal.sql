-- CITHELA patient portal phase 1: verified-email invitation + read-only own appointments.
-- No patient gains staff membership or direct SELECT on tenant data.

create table if not exists public.cithela_patient_links (
  tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
  person_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, person_id),
  constraint cithela_patient_links_person_fkey foreign key (tenant_id, person_id)
    references public.cithela_people(tenant_id,id) on delete cascade
);
create index if not exists cithela_patient_links_user_idx
  on public.cithela_patient_links (user_id, tenant_id);
alter table public.cithela_patient_links enable row level security;
revoke all on public.cithela_patient_links from anon, authenticated;

create table if not exists public.cithela_patient_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  person_id uuid not null,
  target_email text not null,
  token_hash bytea not null unique,
  issued_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz,
  constraint cithela_patient_invites_person_fkey foreign key (tenant_id, person_id)
    references public.cithela_people(tenant_id,id) on delete cascade,
  constraint cithela_patient_invites_token_size check (octet_length(token_hash) = 32)
);
create index if not exists cithela_patient_invites_person_idx
  on public.cithela_patient_invites (tenant_id, person_id, created_at desc);
alter table public.cithela_patient_invites enable row level security;
revoke all on public.cithela_patient_invites from anon, authenticated;

create or replace function public.cithela_patient_invite_issue(
  p_tenant_id uuid, p_person_id uuid, p_email text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text; v_email text := lower(btrim(coalesce(p_email,'')));
  v_token text; v_exp timestamptz := now() + interval '48 hours';
  v_invite_id uuid;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor;
  if v_role is null or v_role not in ('owner','admin','operator') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(v_email)>254 then
    return jsonb_build_object('ok',false,'code','invalid_email');
  end if;
  perform 1 from public.cithela_tenants t
    where t.id=p_tenant_id and t.status='active' for update;
  if not found then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  perform 1 from public.cithela_people p
    where p.tenant_id=p_tenant_id and p.id=p_person_id;
  if not found then return jsonb_build_object('ok',false,'code','person_not_found'); end if;
  if exists (select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.person_id=p_person_id) then
    return jsonb_build_object('ok',false,'code','already_linked');
  end if;
  if (select count(*) from public.cithela_patient_invites i
    where i.tenant_id=p_tenant_id and i.person_id=p_person_id
      and i.created_at>now()-interval '1 hour')>=5 then
    return jsonb_build_object('ok',false,'code','rate_limited');
  end if;
  update public.cithela_patient_invites i set revoked_at=now()
    where i.tenant_id=p_tenant_id and i.person_id=p_person_id
      and i.redeemed_at is null and i.revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.cithela_patient_invites
    (tenant_id,person_id,target_email,token_hash,issued_by,expires_at)
  values (p_tenant_id,p_person_id,v_email,
    extensions.digest(decode(v_token,'hex'),'sha256'),v_actor,v_exp)
  returning id into v_invite_id;
  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values (p_tenant_id,v_actor,'patient_invite_issued','patient',p_person_id,
    jsonb_build_object('invite_id',v_invite_id,'expires_at',v_exp));
  return jsonb_build_object('ok',true,'code','invite_issued',
    'invite_code',v_token,'email',v_email,'expires_at',v_exp);
end
$fn$;

create or replace function public.cithela_patient_invite_redeem(
  p_invite_code text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_user_email text; v_confirmed timestamptz;
  v_code text := lower(btrim(coalesce(p_invite_code,'')));
  v_inv public.cithela_patient_invites%rowtype;
  v_existing uuid;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select lower(btrim(u.email)),u.email_confirmed_at
    into v_user_email,v_confirmed from auth.users u where u.id=v_actor;
  if v_confirmed is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
  if v_code !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok',false,'code','invalid_invite');
  end if;
  select i.* into v_inv from public.cithela_patient_invites i
    where i.token_hash=extensions.digest(decode(v_code,'hex'),'sha256')
    for update;
  if not found or v_inv.expires_at<=now() or v_inv.revoked_at is not null
    or v_inv.redeemed_at is not null
    or v_inv.target_email is distinct from v_user_email then
    return jsonb_build_object('ok',false,'code','invalid_invite');
  end if;
  select l.user_id into v_existing from public.cithela_patient_links l
    where l.tenant_id=v_inv.tenant_id and l.person_id=v_inv.person_id for update;
  if v_existing is not null and v_existing<>v_actor then
    return jsonb_build_object('ok',false,'code','already_linked');
  end if;
  if v_existing is null then
    insert into public.cithela_patient_links(tenant_id,person_id,user_id)
      values(v_inv.tenant_id,v_inv.person_id,v_actor);
  end if;
  update public.cithela_patient_invites
    set redeemed_by=v_actor,redeemed_at=now() where id=v_inv.id;
  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values(v_inv.tenant_id,v_actor,'patient_invite_redeemed','patient',v_inv.person_id,
    jsonb_build_object('invite_id',v_inv.id));
  return jsonb_build_object('ok',true,'code','patient_linked');
end
$fn$;

create or replace function public.cithela_patient_portal()
returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_row record; v_items jsonb; v_profiles jsonb := '[]'::jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  for v_row in
    select l.tenant_id,l.person_id,t.display_name as tenant_name,
      t.timezone,p.display_name as person_name
    from public.cithela_patient_links l
    join public.cithela_tenants t on t.id=l.tenant_id and t.status='active'
    join public.cithela_people p on p.tenant_id=l.tenant_id and p.id=l.person_id
    where l.user_id=v_actor order by t.display_name,p.display_name
  loop
    select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at desc),'[]'::jsonb)
      into v_items
    from (
      select id,starts_at,ends_at,status,service_name,duration_min,resource_name,reason,
        row_version from public.cithela_appointments
      where tenant_id=v_row.tenant_id and person_id=v_row.person_id
      order by starts_at desc limit 100
    ) a;
    v_profiles := v_profiles || jsonb_build_array(jsonb_build_object(
      'tenant_id',v_row.tenant_id,'tenant_name',v_row.tenant_name,
      'person_id',v_row.person_id,'name',v_row.person_name,
      'timezone',v_row.timezone,'appointments',v_items
    ));
  end loop;
  return jsonb_build_object('ok',true,'profiles',v_profiles);
end
$fn$;

revoke all on function public.cithela_patient_invite_issue(uuid,uuid,text) from public,anon;
revoke all on function public.cithela_patient_invite_redeem(text) from public,anon;
revoke all on function public.cithela_patient_portal() from public,anon;
grant execute on function public.cithela_patient_invite_issue(uuid,uuid,text) to authenticated;
grant execute on function public.cithela_patient_invite_redeem(text) to authenticated;
grant execute on function public.cithela_patient_portal() to authenticated;
