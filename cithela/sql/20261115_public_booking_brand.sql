-- CITHELA public-booking branding extension: only exposes already-public tenant brand assets.
-- Does not expose contact records, operational events, appointments or member details.
create or replace function cithela_private.public_booking_catalog(p_slug text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_tenant uuid;v_name text;v_tz text;v_locale text;
  v_theme text;v_logo text;v_brand_updated timestamptz;
  v_services jsonb;v_resources jsonb;
begin
  if p_slug is null or length(p_slug)>50 or p_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$'
    then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select t.id,t.display_name,t.timezone,s.locale,t.brand_theme,t.logo_object_path,t.branding_updated_at
    into v_tenant,v_name,v_tz,v_locale,v_theme,v_logo,v_brand_updated
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
  -- The path is not a secret; the public browser validates tenant-specific immutable logo filename.
  return jsonb_build_object('ok',true,'tenant_id',v_tenant,'name',v_name,
    'timezone',v_tz,'locale',v_locale,'services',v_services,'resources',v_resources,
    'brand_theme',v_theme,'logo_object_path',v_logo,'branding_updated_at',v_brand_updated);
end $$;
