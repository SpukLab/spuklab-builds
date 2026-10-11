-- Adds rosa chicle while keeping the previous plum token for existing tenants.
-- Legacy plum is shown as rosa chicle in the frontend until its next save.
alter table public.cithela_tenants
  drop constraint if exists cithela_brand_theme_allowed;
alter table public.cithela_tenants
  add constraint cithela_brand_theme_allowed
  check (brand_theme in ('sage','ocean','clay','plum','pink'));

create or replace function cithela_private.tenant_branding_update(
  p_tenant_id uuid,p_expected_updated_at timestamptz,p_theme text,p_logo_path text
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();v_role text;v_old public.cithela_tenants%rowtype;
  v_path text:=nullif(btrim(coalesce(p_logo_path,'')),'');
  v_new public.cithela_tenants%rowtype;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_tenant_id is null or p_expected_updated_at is null
    or p_theme is null or p_theme not in ('sage','ocean','clay','plum','pink')
    or octet_length(coalesce(p_logo_path,''))>180 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor;
  if v_role is null or v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select * into v_old from public.cithela_tenants t
    where t.id=p_tenant_id for update;
  if not found or v_old.status<>'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  if v_old.branding_updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  if v_path is not null then
    if v_path !~ ('^'||p_tenant_id::text||'/logo-[0-9a-f]{32}\.(png|jpg|jpeg|webp)$')
      or not exists(
        select 1 from storage.objects o where o.bucket_id='cithela-branding'
        and o.name=v_path
        and (o.owner_id=v_actor::text or v_path=v_old.logo_object_path)
        and (o.metadata->>'mimetype') in ('image/png','image/jpeg','image/webp')
        and (o.metadata->>'size')::bigint <= 524288
      ) then
      return jsonb_build_object('ok',false,'code','invalid_logo');
    end if;
  end if;
  update public.cithela_tenants set brand_theme=p_theme,logo_object_path=v_path,
    branding_updated_at=clock_timestamp()
    where id=p_tenant_id returning * into v_new;
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,'tenant_branding_updated','tenant',p_tenant_id,
    jsonb_build_object('theme',p_theme,'has_logo',v_path is not null));
  return jsonb_build_object('ok',true,'code','branding_updated',
    'branding_updated_at',v_new.branding_updated_at);
end $fn$;

