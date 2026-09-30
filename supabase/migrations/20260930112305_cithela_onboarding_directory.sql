create or replace function cithela_private.bootstrap_tenant(p_display_name text,p_timezone text default 'America/Argentina/Buenos_Aires')
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function cithela_private.bootstrap_tenant(text,text) from public,anon;
grant execute on function cithela_private.bootstrap_tenant(text,text) to authenticated;

create or replace function public.cithela_bootstrap_tenant(p_display_name text,p_timezone text default 'America/Argentina/Buenos_Aires')
returns jsonb language sql security invoker set search_path='' as $$ select cithela_private.bootstrap_tenant(p_display_name,p_timezone); $$;
revoke all on function public.cithela_bootstrap_tenant(text,text) from public,anon;
grant execute on function public.cithela_bootstrap_tenant(text,text) to authenticated;

create or replace function cithela_private.directory_command(p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member_role text; tenant_status text; old_request public.cithela_channel_requests%rowtype;
phone text; clean_name text; create_missing boolean; person public.cithela_people%rowtype; code text; result jsonb; changed boolean:=false;
begin
 if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
 if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200 or p_payload is null
   or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then
   return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
 if p_command<>'person.resolve' then return jsonb_build_object('ok',false,'code','unsupported_command'); end if;
 select m.role into member_role from public.cithela_tenant_memberships m
   where m.tenant_id=p_tenant_id and m.user_id=actor for share;
 if member_role is null or member_role not in ('owner','admin','operator') then
   return jsonb_build_object('ok',false,'code','forbidden'); end if;
 select t.status into tenant_status from public.cithela_tenants t where t.id=p_tenant_id for update;
 if tenant_status is distinct from 'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
 select * into old_request from public.cithela_channel_requests q where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
 if found then
   if old_request.actor_user_id is distinct from actor or old_request.command<>p_command or old_request.request_payload is distinct from p_payload then
     return jsonb_build_object('ok',false,'code','idempotency_conflict'); end if;
   return old_request.response||jsonb_build_object('replayed',true);
 end if;
 begin
   phone:=btrim(coalesce(p_payload->>'phone',''));
   clean_name:=btrim(coalesce(p_payload->>'name',''));
   create_missing:=coalesce((p_payload->>'create_if_missing')::boolean,false);
 exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','invalid_payload'); end;
 if phone !~ '^\+[1-9][0-9]{7,14}$' then return jsonb_build_object('ok',false,'code','invalid_phone'); end if;
 select * into person from public.cithela_people p where p.tenant_id=p_tenant_id and p.phone_e164=phone;
 if found then code:='person_found';
 elsif not create_missing then code:='person_not_found';
 else
   if length(clean_name) not between 1 and 160 then return jsonb_build_object('ok',false,'code','name_required'); end if;
   insert into public.cithela_people(tenant_id,display_name,phone_e164) values(p_tenant_id,clean_name,phone) returning * into person;
   code:='person_created'; changed:=true;
 end if;
 result:=case when code='person_not_found'
   then jsonb_build_object('ok',false,'code',code,'replayed',false)
   else jsonb_build_object('ok',true,'code',code,'person',to_jsonb(person),'replayed',false) end;
 if changed then
   insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
   values(p_tenant_id,actor,'person_created','person',person.id,jsonb_build_object('request_id',p_request_id,'phone',phone));
 end if;
 insert into public.cithela_channel_requests(tenant_id,request_id,command,response,actor_user_id,request_payload)
 values(p_tenant_id,p_request_id,p_command,result,actor,p_payload);
 return result;
end $$;
revoke all on function cithela_private.directory_command(uuid,text,text,jsonb) from public,anon;
grant execute on function cithela_private.directory_command(uuid,text,text,jsonb) to authenticated;

create or replace function public.cithela_directory_command(p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select cithela_private.directory_command(p_tenant_id,p_request_id,p_command,p_payload); $$;
revoke all on function public.cithela_directory_command(uuid,text,text,jsonb) from public,anon;
grant execute on function public.cithela_directory_command(uuid,text,text,jsonb) to authenticated;
