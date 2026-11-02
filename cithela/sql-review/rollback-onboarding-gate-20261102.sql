-- EMERGENCY ROLLBACK for CITHELA bootstrap guard.
-- Reverts to previous function which allows any authenticated memberless user to create a tenant.
-- Only use for a critical operational incident, not after commercial opening.
-- Keep private grant table to retain audit history.
CREATE OR REPLACE FUNCTION cithela_private.bootstrap_tenant(p_display_name text, p_timezone text DEFAULT 'America/Argentina/Buenos_Aires'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); existing_tenant uuid; existing_name text; v_tenant uuid; v_service uuid; v_resource uuid;
clean_name text:=btrim(coalesce(p_display_name,'')); clean_tz text:=btrim(coalesce(p_timezone,''));
begin
 if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
 if length(clean_name) not between 1 and 160 then return jsonb_build_object('ok',false,'code','invalid_name'); end if;
 if clean_tz='' or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=clean_tz) then
   return jsonb_build_object('ok',false,'code','invalid_timezone'); end if;
 perform 1 from auth.users u where u.id=actor for update;
 if not found then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
 select t.id,t.display_name into existing_tenant,existing_name
 from public.cithela_tenant_memberships m join public.cithela_tenants t on t.id=m.tenant_id
 where m.user_id=actor order by m.created_at,t.created_at limit 1;
 if existing_tenant is not null then
   return jsonb_build_object('ok',true,'code','workspace_exists','tenant',jsonb_build_object('id',existing_tenant,'display_name',existing_name));
 end if;
 insert into public.cithela_tenants(display_name,timezone) values(clean_name,clean_tz) returning id into v_tenant;
 insert into public.cithela_tenant_memberships(tenant_id,user_id,role) values(v_tenant,actor,'owner');
 insert into public.cithela_services(tenant_id,name,duration_min) values(v_tenant,'Consulta',30) returning id into v_service;
 insert into public.cithela_resources(tenant_id,name) values(v_tenant,'Profesional principal') returning id into v_resource;
 insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
 values(v_tenant,actor,'workspace_created','tenant',v_tenant,jsonb_build_object('service_id',v_service,'resource_id',v_resource,'timezone',clean_tz));
 return jsonb_build_object('ok',true,'code','workspace_created',
   'tenant',jsonb_build_object('id',v_tenant,'display_name',clean_name,'timezone',clean_tz),
   'default_service_id',v_service,'default_resource_id',v_resource);
end $function$

