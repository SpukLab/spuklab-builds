grant usage on schema cithela_private to service_role;

create table public.cithela_channel_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  external_account_id text not null,
  display_label text,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel,external_account_id),
  unique(tenant_id,id)
);
create index cithela_channel_connections_tenant_idx on public.cithela_channel_connections(tenant_id,status,channel);
alter table public.cithela_channel_connections enable row level security;
create policy cithela_channel_connections_admin_read on public.cithela_channel_connections
  for select to authenticated using (
    exists (
      select 1 from public.cithela_tenant_memberships m
      where m.tenant_id=cithela_channel_connections.tenant_id
        and m.user_id=(select auth.uid())
        and m.role in ('owner','admin')
    )
  );
revoke all on public.cithela_channel_connections from anon,authenticated;
grant select on public.cithela_channel_connections to authenticated;

create function cithela_private.channel_configuration_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  member_role text;
  tenant_status text;
  old_request public.cithela_channel_requests%rowtype;
  v_channel text;
  v_external text;
  v_label text;
  existing public.cithela_channel_connections%rowtype;
  conn public.cithela_channel_connections%rowtype;
  result jsonb;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command<>'channel.bind' then return jsonb_build_object('ok',false,'code','unsupported_command'); end if;

  select m.role into member_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=actor for share;
  if member_role is null or member_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;

  select t.status into tenant_status from public.cithela_tenants t
    where t.id=p_tenant_id for update;
  if tenant_status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;

  select * into old_request from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if old_request.actor_user_id is distinct from actor
      or old_request.command<>p_command
      or old_request.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return old_request.response||jsonb_build_object('replayed',true);
  end if;

  v_channel:=lower(btrim(coalesce(p_payload->>'channel','')));
  v_external:=btrim(coalesce(p_payload->>'external_account_id',''));
  v_label:=nullif(btrim(coalesce(p_payload->>'display_label','')),'');
  if v_channel<>'whatsapp' or length(v_external) not between 1 and 200
    or (v_label is not null and length(v_label)>160) then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  select * into existing from public.cithela_channel_connections c
    where c.channel=v_channel and c.external_account_id=v_external
    for update;
  if found and existing.tenant_id<>p_tenant_id then
    return jsonb_build_object('ok',false,'code','channel_already_bound');
  end if;

  if found then
    update public.cithela_channel_connections c
      set display_label=coalesce(v_label,c.display_label),status='active',updated_at=now()
      where c.id=existing.id
      returning * into conn;
  else
    insert into public.cithela_channel_connections(tenant_id,channel,external_account_id,display_label)
      values(p_tenant_id,v_channel,v_external,v_label)
      returning * into conn;
  end if;

  result:=jsonb_build_object(
    'ok',true,'code','channel_bound','replayed',false,
    'connection',jsonb_build_object(
      'id',conn.id,'channel',conn.channel,'external_account_id',conn.external_account_id,
      'display_label',conn.display_label,'status',conn.status
    )
  );
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(
    p_tenant_id,actor,'channel_bound','channel_connection',conn.id,
    jsonb_build_object('channel',v_channel,'external_account_id',v_external,'request_id',p_request_id)
  );
  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(p_tenant_id,p_request_id,p_command,result,actor,p_payload);
  return result;
end $$;
revoke all on function cithela_private.channel_configuration_command(uuid,text,text,jsonb) from public,anon;
grant execute on function cithela_private.channel_configuration_command(uuid,text,text,jsonb) to authenticated;

create function public.cithela_channel_configuration_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select cithela_private.channel_configuration_command(p_tenant_id,p_request_id,p_command,p_payload);
$$;
revoke all on function public.cithela_channel_configuration_command(uuid,text,text,jsonb) from public,anon;
grant execute on function public.cithela_channel_configuration_command(uuid,text,text,jsonb) to authenticated;

create function cithela_private.channel_route(
  p_channel text,p_external_account_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  conn public.cithela_channel_connections%rowtype;
  tenant public.cithela_tenants%rowtype;
begin
  select * into conn from public.cithela_channel_connections c
    where c.channel=lower(btrim(coalesce(p_channel,'')))
      and c.external_account_id=btrim(coalesce(p_external_account_id,''))
      and c.status='active';
  if not found then return jsonb_build_object('ok',false,'code','channel_not_found'); end if;

  select * into tenant from public.cithela_tenants t where t.id=conn.tenant_id and t.status='active';
  if not found then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;

  return jsonb_build_object(
    'ok',true,'code','channel_routed',
    'connection_id',conn.id,'tenant_id',tenant.id,'timezone',tenant.timezone,
    'channel',conn.channel,'external_account_id',conn.external_account_id
  );
end $$;
revoke all on function cithela_private.channel_route(text,text) from public,anon,authenticated;
grant execute on function cithela_private.channel_route(text,text) to service_role;

create function public.cithela_channel_route(
  p_channel text,p_external_account_id text
) returns jsonb language sql security invoker set search_path='' as $$
  select cithela_private.channel_route(p_channel,p_external_account_id);
$$;
revoke all on function public.cithela_channel_route(text,text) from public,anon,authenticated;
grant execute on function public.cithela_channel_route(text,text) to service_role;
