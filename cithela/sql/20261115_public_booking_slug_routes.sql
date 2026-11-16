-- CITHELA friendly booking links with permanent backwards compatibility for existing QR URLs.
-- Every new/old slug remains permanently bound to the same establishment. No patient data exposed.
create table if not exists public.cithela_public_booking_slug_routes(
 slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
 tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
 created_at timestamptz not null default statement_timestamp()
);
create index if not exists cithela_booking_slug_routes_tenant_idx
 on public.cithela_public_booking_slug_routes(tenant_id);
alter table public.cithela_public_booking_slug_routes enable row level security;
revoke all on public.cithela_public_booking_slug_routes from public,anon,authenticated;
insert into public.cithela_public_booking_slug_routes(slug,tenant_id)
select slug,tenant_id from public.cithela_public_booking_settings
on conflict(slug) do nothing;

create or replace function cithela_private.track_public_booking_slug()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or old.slug is distinct from new.slug then
   insert into public.cithela_public_booking_slug_routes(slug,tenant_id)
   values(new.slug,new.tenant_id)
   on conflict(slug) do update set tenant_id=excluded.tenant_id
     where public.cithela_public_booking_slug_routes.tenant_id=excluded.tenant_id;
   if not found then
     raise exception 'This booking link name is already assigned'
       using errcode='23505',constraint='cithela_public_booking_slug_routes_pkey';
   end if;
 end if;
 return new;
end
$$;
revoke all on function cithela_private.track_public_booking_slug() from public,anon,authenticated;
drop trigger if exists cithela_track_public_booking_slug on public.cithela_public_booking_settings;
create trigger cithela_track_public_booking_slug
after insert or update of slug on public.cithela_public_booking_settings
for each row execute function cithela_private.track_public_booking_slug();

-- Resolve slug -> tenant in all three patient-facing endpoints, preserving current enabled and paid checks.
CREATE OR REPLACE FUNCTION cithela_private.public_booking_attach(p_slug text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select s.tenant_id into v_tenant from public.cithela_public_booking_slug_routes r
    join public.cithela_public_booking_settings s on s.tenant_id=r.tenant_id
    join public.cithela_tenants t on t.id=s.tenant_id
    where r.slug=p_slug and s.enabled and t.status='active';
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(v_tenant)->>'can_book')::boolean,false)
    then return jsonb_build_object('ok',false,'code','not_available'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text||':'||v_email,0));
  select l.person_id into v_linked from public.cithela_patient_links l
    where l.tenant_id=v_tenant and l.user_id=v_actor order by l.created_at limit 1;
  if v_linked is not null then
    return jsonb_build_object('ok',true,'tenant_id',v_tenant,'person_id',v_linked,'existing',true);
  end if;
  select count(*),(array_agg(p.id order by p.created_at))[1] into v_count,v_person from public.cithela_people p
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
end $function$
;

CREATE OR REPLACE FUNCTION cithela_private.public_booking_catalog(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;v_name text;v_tz text;v_locale text;
  v_theme text;v_logo text;v_brand_updated timestamptz;
  v_services jsonb;v_resources jsonb;
begin
  if p_slug is null or length(p_slug)>50 or p_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$'
    then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select t.id,t.display_name,t.timezone,s.locale,t.brand_theme,t.logo_object_path,t.branding_updated_at
    into v_tenant,v_name,v_tz,v_locale,v_theme,v_logo,v_brand_updated
    from public.cithela_public_booking_slug_routes r
    join public.cithela_public_booking_settings s on s.tenant_id=r.tenant_id
    join public.cithela_tenants t on t.id=s.tenant_id
    where r.slug=p_slug and s.enabled and t.status='active';
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(v_tenant)->>'can_book')::boolean,false)
    then return jsonb_build_object('ok',false,'code','not_available'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,
    'duration_min',duration_min,'deposit_amount_minor',deposit_amount_minor,
    'deposit_currency',deposit_currency) order by name),'[]'::jsonb)
    into v_services from public.cithela_services where tenant_id=v_tenant and active;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb)
    into v_resources from public.cithela_resources where tenant_id=v_tenant and active;
  -- The path is not a secret; the public browser validates tenant-specific immutable logo filename.
  return jsonb_build_object('ok',true,'tenant_id',v_tenant,'name',v_name,
    'timezone',v_tz,'locale',v_locale,'services',v_services,'resources',v_resources,
    'brand_theme',v_theme,'logo_object_path',v_logo,'branding_updated_at',v_brand_updated);
end $function$
;

CREATE OR REPLACE FUNCTION cithela_private.public_booking_slots(p_slug text, p_service_id uuid, p_resource_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;v_tz text;v_now timestamptz:=statement_timestamp();v_response jsonb;v_slots jsonb;
begin
  if p_slug is null or length(p_slug)>50 then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select t.id,t.timezone into v_tenant,v_tz
    from public.cithela_public_booking_slug_routes r
    join public.cithela_public_booking_settings s on s.tenant_id=r.tenant_id
    join public.cithela_tenants t on t.id=s.tenant_id
    where r.slug=p_slug and s.enabled and t.status='active';
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
end $function$
;
