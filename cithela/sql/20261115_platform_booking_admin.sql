-- CITHELA platform booking management. Server-only RPC. No browser permission.
-- The commercial Edge Function validates verified platform-admin JWT before this RPC.
create or replace function public.cithela_commercial_admin_booking_command(
 p_actor uuid,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_tid uuid; v_name text; v_tz text; v_status text; v_entitlement jsonb;
 v_s public.cithela_public_booking_settings%rowtype;
 v_slug text;v_locale text;v_enabled boolean;v_timezone text;
begin
 if p_actor is null or not exists (
  select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
 ) then return jsonb_build_object('ok',false,'code','admin_not_verified');end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>1500
 then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
 if p_action not in ('booking_read','booking_save','booking_timezone')
 then return jsonb_build_object('ok',false,'code','unknown_action');end if;
 if coalesce(p_payload->>'tenant_id','') !~
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 then return jsonb_build_object('ok',false,'code','invalid_tenant');end if;
 v_tid:=(p_payload->>'tenant_id')::uuid;
 -- Lock the tenant for configuration updates and preserve its current schedules.
 select t.display_name,t.timezone,t.status into v_name,v_tz,v_status
 from public.cithela_tenants t where t.id=v_tid for update;
 if v_name is null then return jsonb_build_object('ok',false,'code','tenant_not_found');end if;
 if v_status<>'active' then return jsonb_build_object('ok',false,'code','tenant_inactive');end if;
 v_entitlement:=cithela_private.commercial_entitlement_snapshot(v_tid);
 if p_action='booking_timezone' then
  v_timezone:=p_payload->>'timezone';
  if v_timezone is null or length(v_timezone)>100 or
   not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=v_timezone)
  then return jsonb_build_object('ok',false,'code','invalid_timezone');end if;
  if v_tz is distinct from v_timezone then
    if exists(select 1 from public.cithela_appointments a where a.tenant_id=v_tid)
    then return jsonb_build_object('ok',false,'code','appointment_history_locked');end if;
    update public.cithela_tenants set timezone=v_timezone where id=v_tid;
    v_tz:=v_timezone;
  end if;
  return jsonb_build_object('ok',true,'code','timezone_updated','timezone',v_tz);
 end if;
 select * into v_s from public.cithela_public_booking_settings where tenant_id=v_tid;
 v_slug:=coalesce(v_s.slug,'c-'||left(replace(v_tid::text,'-',''),12));
 v_locale:=coalesce(v_s.locale,'es');
 v_enabled:=coalesce(v_s.enabled,false);
 if p_action='booking_save' then
  v_slug:=coalesce(nullif(lower(btrim(p_payload->>'slug')),''),v_slug);
  v_locale:=coalesce(p_payload->>'locale',v_locale);
  if p_payload->'enabled' is null or jsonb_typeof(p_payload->'enabled')<>'boolean'
  then return jsonb_build_object('ok',false,'code','invalid_settings');end if;
  v_enabled:=(p_payload->>'enabled')::boolean;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' or
   v_slug in ('admin','cithela','login','signup','reservar','booking','api','www','app') or
   v_locale not in ('es','en')
  then return jsonb_build_object('ok',false,'code','invalid_settings');end if;
  if v_enabled then
   if not coalesce((v_entitlement->>'can_book')::boolean,false)
    then return jsonb_build_object('ok',false,'code','subscription_required');end if;
   if not exists(select 1 from public.cithela_services s where s.tenant_id=v_tid and s.active)
    then return jsonb_build_object('ok',false,'code','services_missing');end if;
   if not exists(select 1 from public.cithela_resources r where r.tenant_id=v_tid and r.active)
    then return jsonb_build_object('ok',false,'code','resources_missing');end if;
   if not exists(select 1 from public.cithela_working_hours w where w.tenant_id=v_tid)
    then return jsonb_build_object('ok',false,'code','hours_missing');end if;
  end if;
  begin
   insert into public.cithela_public_booking_settings(tenant_id,slug,enabled,locale)
   values (v_tid,v_slug,v_enabled,v_locale)
   on conflict(tenant_id) do update set slug=excluded.slug,enabled=excluded.enabled,
    locale=excluded.locale,updated_at=statement_timestamp();
  exception when unique_violation then
   return jsonb_build_object('ok',false,'code','slug_in_use');
  end;
 end if;
 return jsonb_build_object('ok',true,'code','booking_config','tenant_id',v_tid,
  'tenant_name',v_name,'timezone',v_tz,'slug',v_slug,'locale',v_locale,'enabled',v_enabled,
  'commercial_status',v_entitlement->>'status',
  'commercial_can_book',coalesce((v_entitlement->>'can_book')::boolean,false),
  'url','https://spuklab.github.io/spuklab-builds/cithela/reservar.html?c='||v_slug);
end
$$;
revoke all on function public.cithela_commercial_admin_booking_command(uuid,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.cithela_commercial_admin_booking_command(uuid,text,jsonb)
 to service_role;
