-- Improve error reporting for the existing owner/admin-only booking configuration RPC.
-- No changes to trials, subscriptions, commercial entitlements or public booking activation.
-- The public catalog continues enforcing active entitlements independently.
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
  v_entitlement jsonb;
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
  v_entitlement:=cithela_private.commercial_entitlement_snapshot(p_tenant_id);
  if p_save then
    v_slug:=coalesce(nullif(lower(btrim(p_slug)),''),v_slug);
    v_enabled:=coalesce(p_enabled,v_enabled);
    v_locale:=coalesce(p_locale,v_locale);
    if v_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$'
      or v_slug in ('admin','cithela','login','signup','reservar','booking','api','www','app')
      or v_locale not in ('es','en') then
      return jsonb_build_object('ok',false,'code','invalid_settings');
    end if;
    if v_enabled then
      if not coalesce((v_entitlement->>'can_book')::boolean,false) then
        return jsonb_build_object('ok',false,'code','subscription_required');
      end if;
      if not exists(select 1 from public.cithela_services where tenant_id=p_tenant_id and active) then
        return jsonb_build_object('ok',false,'code','services_missing');
      end if;
      if not exists(select 1 from public.cithela_resources where tenant_id=p_tenant_id and active) then
        return jsonb_build_object('ok',false,'code','resources_missing');
      end if;
      if not exists(select 1 from public.cithela_working_hours where tenant_id=p_tenant_id) then
        return jsonb_build_object('ok',false,'code','hours_missing');
      end if;
    end if;
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
    'commercial_status',v_entitlement->>'status',
    'commercial_can_book',coalesce((v_entitlement->>'can_book')::boolean,false),
    'url','https://spuklab.github.io/spuklab-builds/cithela/reservar.html?c='||v_slug);
end $$;
