-- CITHELA | Public booking pilot. Safe default: disabled for every tenant.
-- This script adds API endpoints; it does not enable public booking or open professional signups.
create table if not exists public.cithela_public_booking_settings (
  tenant_id uuid primary key references public.cithela_tenants(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  enabled boolean not null default false,
  locale text not null default 'es' check (locale in ('es','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cithela_public_booking_settings enable row level security;
revoke all on public.cithela_public_booking_settings from anon, authenticated;

create or replace function cithela_private.public_booking_config(
  p_tenant_id uuid, p_save boolean default false, p_slug text default null,
  p_enabled boolean default null, p_locale text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_slug text;
  v_enabled boolean;
  v_locale text;
  v_name text;
  v_timezone text;
  v_settings public.cithela_public_booking_settings%rowtype;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if not exists(select 1 from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor and m.role in ('owner','admin'))
    then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select t.display_name,t.timezone into v_name,v_timezone
  from public.cithela_tenants t where t.id=p_tenant_id and t.status='active';
  if v_name is null then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  select * into v_settings from public.cithela_public_booking_settings where tenant_id=p_tenant_id;
  v_slug:=coalesce(v_settings.slug,'c-'||left(replace(p_tenant_id::text,'-',''),12));
  v_enabled:=coalesce(v_settings.enabled,false);
  v_locale:=coalesce(v_settings.locale,'es');
  if p_save then
    v_slug:=coalesce(nullif(lower(btrim(p_slug)),''),v_slug);
    v_enabled:=coalesce(p_enabled,v_enabled);
    v_locale:=coalesce(p_locale,v_locale);
    if v_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$'
      or v_slug in ('admin','cithela','login','signup','reservar','booking','api','www','app')
      or v_locale not in ('es','en') then
      return jsonb_build_object('ok',false,'code','invalid_settings');
    end if;
    if v_enabled and (
      not exists(select 1 from public.cithela_services where tenant_id=p_tenant_id and active)
      or not exists(select 1 from public.cithela_resources where tenant_id=p_tenant_id and active)
      or not exists(select 1 from public.cithela_working_hours where tenant_id=p_tenant_id)
      or not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false)
    ) then return jsonb_build_object('ok',false,'code','agenda_not_ready'); end if;
    begin
      insert into public.cithela_public_booking_settings(tenant_id,slug,enabled,locale)
        values(p_tenant_id,v_slug,v_enabled,v_locale)
      on conflict(tenant_id) do update
        set slug=excluded.slug,enabled=excluded.enabled,locale=excluded.locale,updated_at=now();
    exception when unique_violation then
      return jsonb_build_object('ok',false,'code','slug_in_use');
    end;
  end if;
  return jsonb_build_object('ok',true,'tenant_id',p_tenant_id,'tenant_name',v_name,
    'timezone',v_timezone,'slug',v_slug,'enabled',v_enabled,'locale',v_locale,
    'url','https://spuklab.github.io/spuklab-builds/cithela/reservar.html?c='||v_slug);
end $$;

create or replace function public.cithela_public_booking_config(
  p_tenant_id uuid, p_save boolean default false, p_slug text default null,
  p_enabled boolean default null, p_locale text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select cithela_private.public_booking_config(p_tenant_id,p_save,p_slug,p_enabled,p_locale);
$$;
revoke all on function cithela_private.public_booking_config(uuid,boolean,text,boolean,text) from public,anon;
grant execute on function cithela_private.public_booking_config(uuid,boolean,text,boolean,text) to authenticated;
revoke all on function public.cithela_public_booking_config(uuid,boolean,text,boolean,text) from public,anon;
grant execute on function public.cithela_public_booking_config(uuid,boolean,text,boolean,text) to authenticated;

create or replace function cithela_private.public_booking_catalog(p_slug text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;v_name text;v_tz text;v_locale text;v_services jsonb;v_resources jsonb;
begin
  if p_slug is null or length(p_slug)>50 or p_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$'
    then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select t.id,t.display_name,t.timezone,s.locale into v_tenant,v_name,v_tz,v_locale
    from public.cithela_public_booking_settings s
    join public.cithela_tenants t on t.id=s.tenant_id
    where s.slug=p_slug and s.enabled and t.status='active';
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(v_tenant)->>'can_book')::boolean,false)
    then return jsonb_build_object('ok',false,'code','not_available'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,
    'duration_min',duration_min,'deposit_amount_minor',deposit_amount_minor,
    'deposit_currency',deposit_currency) order by name),'[]'::jsonb)
    into v_services from public.cithela_services where tenant_id=v_tenant and active;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb)
    into v_resources from public.cithela_resources where tenant_id=v_tenant and active;
  return jsonb_build_object('ok',true,'tenant_id',v_tenant,'name',v_name,
    'timezone',v_tz,'locale',v_locale,'services',v_services,'resources',v_resources);
end $$;

-- Deliberately public, read-only RPC. No patient, appointment or membership fields leave this endpoint.
create or replace function public.cithela_public_booking_catalog(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select cithela_private.public_booking_catalog(p_slug);
$$;
revoke all on function public.cithela_public_booking_catalog(text) from public,anon,authenticated;
grant execute on function public.cithela_public_booking_catalog(text) to anon,authenticated;
revoke all on function cithela_private.public_booking_catalog(text) from public,anon,authenticated;

create or replace function cithela_private.public_booking_slots(
  p_slug text,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;v_tz text;v_now timestamptz:=statement_timestamp();v_response jsonb;v_slots jsonb;
begin
  if p_slug is null or length(p_slug)>50 then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select t.id,t.timezone into v_tenant,v_tz
    from public.cithela_public_booking_settings s
    join public.cithela_tenants t on t.id=s.tenant_id
    where s.slug=p_slug and s.enabled and t.status='active';
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if p_date is null or p_date<(v_now at time zone v_tz)::date
    or p_date>(v_now at time zone v_tz)::date+90
    then return jsonb_build_object('ok',false,'code','invalid_date'); end if;
  v_response:=cithela_private.channel_availability_core(v_tenant,p_service_id,p_resource_id,p_date);
  if not coalesce((v_response->>'ok')::boolean,false) then return v_response; end if;
  select coalesce(jsonb_agg(x.slot order by x.slot),'[]'::jsonb) into v_slots
    from (select value as slot from jsonb_array_elements_text(v_response->'slots')
      where (p_date+value::time) at time zone v_tz >= v_now+interval '2 hours') x;
  return jsonb_build_object('ok',true,'slots',v_slots,'timezone',v_tz,'date',p_date);
end $$;

create or replace function public.cithela_public_booking_slots(
  p_slug text,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb language sql stable security definer set search_path='' as $$
  select cithela_private.public_booking_slots(p_slug,p_service_id,p_resource_id,p_date);
$$;
revoke all on function public.cithela_public_booking_slots(text,uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.cithela_public_booking_slots(text,uuid,uuid,date) to anon,authenticated;
revoke all on function cithela_private.public_booking_slots(text,uuid,uuid,date) from public,anon,authenticated;

-- Patient self-link requires ownership of an explicitly verified email and never trusts a client-supplied tenant/person.
create or replace function cithela_private.public_booking_attach(p_slug text,p_display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_email text;v_tenant uuid;v_person uuid;v_linked uuid;
  v_name text:=btrim(coalesce(p_display_name,''));v_count int;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select lower(btrim(u.email)) into v_email from auth.users u
    where u.id=v_actor and u.email_confirmed_at is not null and u.email is not null;
  if v_email is null then return jsonb_build_object('ok',false,'code','verify_email'); end if;
  if v_name='' or length(v_name)>100 or v_name ~ '[[:cntrl:]]'
    then return jsonb_build_object('ok',false,'code','invalid_name'); end if;
  if p_slug is null or length(p_slug)>50 then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select s.tenant_id into v_tenant from public.cithela_public_booking_settings s
    join public.cithela_tenants t on t.id=s.tenant_id
    where s.slug=p_slug and s.enabled and t.status='active';
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(v_tenant)->>'can_book')::boolean,false)
    then return jsonb_build_object('ok',false,'code','not_available'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text||':'||v_email,0));
  select l.person_id into v_linked from public.cithela_patient_links l
    where l.tenant_id=v_tenant and l.user_id=v_actor order by l.created_at limit 1;
  if v_linked is not null then
    return jsonb_build_object('ok',true,'tenant_id',v_tenant,'person_id',v_linked,'existing',true);
  end if;
  select count(*),min(p.id) into v_count,v_person from public.cithela_people p
    where p.tenant_id=v_tenant and lower(btrim(p.contact_email))=v_email;
  if v_count>1 then return jsonb_build_object('ok',false,'code','contact_ambiguous'); end if;
  if v_count=1 and exists(select 1 from public.cithela_patient_links l
      where l.tenant_id=v_tenant and l.person_id=v_person and l.user_id<>v_actor)
    then return jsonb_build_object('ok',false,'code','contact_in_use'); end if;
  if v_count=0 then
    -- A bounded pilot throttle; also requires a verified auth account.
    if (select count(*) from public.cithela_people p
       where p.tenant_id=v_tenant and p.created_at>now()-interval '10 minutes')>=25
      then return jsonb_build_object('ok',false,'code','temporarily_unavailable'); end if;
    insert into public.cithela_people(tenant_id,display_name,contact_email)
      values(v_tenant,v_name,v_email) returning id into v_person;
  end if;
  insert into public.cithela_patient_links(tenant_id,person_id,user_id)
    values(v_tenant,v_person,v_actor) on conflict(tenant_id,person_id) do nothing;
  if not exists(select 1 from public.cithela_patient_links l
    where l.tenant_id=v_tenant and l.person_id=v_person and l.user_id=v_actor)
    then return jsonb_build_object('ok',false,'code','contact_in_use'); end if;
  return jsonb_build_object('ok',true,'tenant_id',v_tenant,'person_id',v_person,'existing',v_count>0);
end $$;
create or replace function public.cithela_public_booking_attach(p_slug text,p_display_name text)
returns jsonb language sql security invoker set search_path='' as $$
  select cithela_private.public_booking_attach(p_slug,p_display_name);
$$;
revoke all on function cithela_private.public_booking_attach(text,text) from public,anon;
grant execute on function cithela_private.public_booking_attach(text,text) to authenticated;
revoke all on function public.cithela_public_booking_attach(text,text) from public,anon;
grant execute on function public.cithela_public_booking_attach(text,text) to authenticated;
