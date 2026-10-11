-- CITHELA: tenant-scoped transfer details for supervised deposit requests.
-- No payment is collected or verified by this migration.
alter table public.cithela_tenants
  add column if not exists transfer_alias text,
  add column if not exists transfer_holder text,
  add column if not exists payment_config_updated_at timestamptz not null default now();

do $guard$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.cithela_tenants'::regclass and conname='cithela_transfer_alias_format') then
    alter table public.cithela_tenants add constraint cithela_transfer_alias_format
      check (transfer_alias is null or transfer_alias ~ '^[a-z0-9][a-z0-9.-]{4,18}[a-z0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.cithela_tenants'::regclass and conname='cithela_transfer_holder_format') then
    alter table public.cithela_tenants add constraint cithela_transfer_holder_format
      check (transfer_holder is null or
        (transfer_alias is not null and length(btrim(transfer_holder)) between 2 and 120
         and transfer_holder !~ '[[:cntrl:]]'));
  end if;
end $guard$;

create or replace function cithela_private.tenant_payment_config_update(
  p_tenant_id uuid,p_expected_updated_at timestamptz,p_alias text,p_holder text
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();v_role text;v_current public.cithela_tenants%rowtype;
  v_alias text:=nullif(lower(btrim(coalesce(p_alias,''))),'');
  v_holder text:=nullif(btrim(coalesce(p_holder,'')),'');
  v_saved public.cithela_tenants%rowtype;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_tenant_id is null or p_expected_updated_at is null
    or octet_length(coalesce(p_alias,''))>80
    or octet_length(coalesce(p_holder,''))>480 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor;
  if v_role is null or v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select * into v_current from public.cithela_tenants t where t.id=p_tenant_id for update;
  if not found or v_current.status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  if v_current.payment_config_updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  if (v_alias is not null and v_alias !~ '^[a-z0-9][a-z0-9.-]{4,18}[a-z0-9]$')
    or (v_holder is not null and
      (v_alias is null or length(v_holder) not between 2 and 120
       or v_holder ~ '[[:cntrl:]]')) then
    return jsonb_build_object('ok',false,'code','invalid_payment_config');
  end if;
  update public.cithela_tenants t set
    transfer_alias=v_alias,transfer_holder=v_holder,payment_config_updated_at=clock_timestamp()
    where t.id=p_tenant_id returning * into v_saved;
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,'payment_config_updated','tenant',p_tenant_id,
    jsonb_build_object('has_alias',v_alias is not null,'has_holder',v_holder is not null,
      'payment_config_updated_at',v_saved.payment_config_updated_at));
  return jsonb_build_object('ok',true,'code','payment_config_updated',
    'payment_config_updated_at',v_saved.payment_config_updated_at);
end $fn$;

create or replace function public.cithela_tenant_payment_config_update(
  p_tenant_id uuid,p_expected_updated_at timestamptz,p_alias text,p_holder text
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.tenant_payment_config_update(
    p_tenant_id,p_expected_updated_at,p_alias,p_holder);
$fn$;

revoke all on function cithela_private.tenant_payment_config_update(uuid,timestamptz,text,text) from public,anon;
revoke all on function public.cithela_tenant_payment_config_update(uuid,timestamptz,text,text) from public,anon;
grant execute on function cithela_private.tenant_payment_config_update(uuid,timestamptz,text,text) to authenticated;
grant execute on function public.cithela_tenant_payment_config_update(uuid,timestamptz,text,text) to authenticated;
