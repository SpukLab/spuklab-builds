-- CITHELA 2026-11-16. Read-only share link for a verified tenant member.
-- No public table grants; never exposes a disabled or non-bookable booking URL.
create or replace function cithela_private.professional_booking_share(p_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_slug text;
  v_enabled boolean;
  v_can_book boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok',false,'code','unauthenticated');
  end if;
  if not exists(
    select 1 from public.cithela_tenant_memberships m
    join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=auth.uid()
      and m.role in ('owner','admin','operator') and t.status='active'
  ) then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select s.slug,s.enabled into v_slug,v_enabled
  from public.cithela_public_booking_settings s
  where s.tenant_id=p_tenant_id;
  if not coalesce(v_enabled,false) or v_slug is null then
    return jsonb_build_object('ok',true,'enabled',false,'url',null,'slug',null);
  end if;
  v_can_book:=coalesce(
    (cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false
  );
  if not v_can_book then
    return jsonb_build_object('ok',true,'enabled',false,'url',null,'slug',null);
  end if;
  return jsonb_build_object('ok',true,'enabled',true,'slug',v_slug,
    'url','https://spuklab.github.io/spuklab-builds/cithela/reservar.html?c='||v_slug);
end $$;
revoke all on function cithela_private.professional_booking_share(uuid) from public,anon;
grant execute on function cithela_private.professional_booking_share(uuid) to authenticated;

create or replace function public.cithela_professional_booking_share(p_tenant_id uuid)
returns jsonb
language sql stable security invoker set search_path=''
as $$
  select cithela_private.professional_booking_share(p_tenant_id);
$$;
revoke all on function public.cithela_professional_booking_share(uuid) from public,anon;
grant execute on function public.cithela_professional_booking_share(uuid) to authenticated;
