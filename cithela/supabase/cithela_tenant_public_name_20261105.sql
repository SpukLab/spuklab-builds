-- CITHELA: change the tenant's public name without touching branding, bookings or patient records.
-- The patient portal already reads cithela_tenants.display_name from the linked tenant.
create or replace function cithela_private.tenant_name_update(
  p_tenant_id uuid, p_expected_name text, p_name text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_current text;
  v_new text := regexp_replace(btrim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g');
begin
  if v_actor is null then
    return jsonb_build_object('ok',false,'code','unauthenticated');
  end if;
  if p_tenant_id is null or p_expected_name is null
      or char_length(v_new) not between 1 and 160
      or octet_length(v_new) > 640
      or v_new ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  select m.role into v_role
  from public.cithela_tenant_memberships m
  where m.tenant_id=p_tenant_id and m.user_id=v_actor;

  if v_role is null or v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;

  select t.display_name into v_current
  from public.cithela_tenants t
  where t.id=p_tenant_id and t.status='active'
  for update;
  if not found then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  if v_current is distinct from p_expected_name then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  if v_current=v_new then
    return jsonb_build_object('ok',true,'code','unchanged','display_name',v_current);
  end if;

  update public.cithela_tenants set display_name=v_new where id=p_tenant_id;
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(
    p_tenant_id,v_actor,'tenant_public_name_updated','tenant',p_tenant_id,
    jsonb_build_object('old_name',v_current,'new_name',v_new)
  );
  return jsonb_build_object('ok',true,'code','name_updated','display_name',v_new);
end $fn$;

create or replace function public.cithela_tenant_name_update(
  p_tenant_id uuid, p_expected_name text, p_name text
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.tenant_name_update(p_tenant_id,p_expected_name,p_name);
$fn$;

revoke all on function cithela_private.tenant_name_update(uuid,text,text) from public,anon;
revoke all on function public.cithela_tenant_name_update(uuid,text,text) from public,anon;
grant execute on function cithela_private.tenant_name_update(uuid,text,text) to authenticated;
grant execute on function public.cithela_tenant_name_update(uuid,text,text) to authenticated;
