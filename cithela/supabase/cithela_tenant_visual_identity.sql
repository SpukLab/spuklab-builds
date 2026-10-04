-- CITHELA tenant-scoped visual identity. Logos are PUBLIC branding assets only.
alter table public.cithela_tenants
  add column if not exists brand_theme text not null default 'sage',
  add column if not exists logo_object_path text,
  add column if not exists branding_updated_at timestamptz not null default now();
do $guards$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.cithela_tenants'::regclass and conname='cithela_brand_theme_allowed') then
    alter table public.cithela_tenants add constraint cithela_brand_theme_allowed
      check (brand_theme in ('sage','ocean','clay','plum'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.cithela_tenants'::regclass and conname='cithela_logo_object_path_format') then
    alter table public.cithela_tenants add constraint cithela_logo_object_path_format
      check (logo_object_path is null or logo_object_path ~ '^[0-9a-f-]{36}/logo-[0-9a-f]{32}\\.(png|jpg|jpeg|webp)$');
  end if;
end $guards$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cithela-branding','cithela-branding',true,524288,ARRAY['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true,file_size_limit=524288,
  allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp'];

drop policy if exists cithela_branding_owner_insert on storage.objects;
create policy cithela_branding_owner_insert on storage.objects
  for insert to authenticated with check (
    bucket_id='cithela-branding'
    and name ~ '^[0-9a-f-]{36}/logo-[0-9a-f]{32}\\.(png|jpg|jpeg|webp)$'
    and exists (
      select 1 from public.cithela_tenant_memberships m
      join public.cithela_tenants t on t.id=m.tenant_id
      where m.user_id=(select auth.uid()) and m.role in ('owner','admin')
      and t.status='active' and m.tenant_id::text=(storage.foldername(name))[1]
    )
  );
drop policy if exists cithela_branding_owner_select on storage.objects;
create policy cithela_branding_owner_select on storage.objects
  for select to authenticated using (
    bucket_id='cithela-branding'
    and exists (select 1 from public.cithela_tenant_memberships m
      where m.user_id=(select auth.uid()) and m.role in ('owner','admin')
      and m.tenant_id::text=(storage.foldername(name))[1])
  );
drop policy if exists cithela_branding_owner_delete on storage.objects;
create policy cithela_branding_owner_delete on storage.objects
  for delete to authenticated using (
    bucket_id='cithela-branding'
    and exists (select 1 from public.cithela_tenant_memberships m
      where m.user_id=(select auth.uid()) and m.role in ('owner','admin')
      and m.tenant_id::text=(storage.foldername(name))[1])
  );

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
    or p_theme is null or p_theme not in ('sage','ocean','clay','plum')
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
    if v_path !~ ('^'||p_tenant_id::text||'/logo-[0-9a-f]{32}\\.(png|jpg|jpeg|webp)$')
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

create or replace function public.cithela_tenant_branding_update(
  p_tenant_id uuid,p_expected_updated_at timestamptz,p_theme text,p_logo_path text
) returns jsonb language sql security invoker set search_path to ''
as $fn$
 select cithela_private.tenant_branding_update(
   p_tenant_id,p_expected_updated_at,p_theme,p_logo_path);
$fn$;
revoke all on function cithela_private.tenant_branding_update(uuid,timestamptz,text,text) from public,anon;
revoke all on function public.cithela_tenant_branding_update(uuid,timestamptz,text,text) from public,anon;
grant execute on function cithela_private.tenant_branding_update(uuid,timestamptz,text,text) to authenticated;
grant execute on function public.cithela_tenant_branding_update(uuid,timestamptz,text,text) to authenticated;

-- Existing RPC returns branding only for the patient's linked, active tenant.
create or replace function cithela_private.patient_portal()
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_row record;v_items jsonb;v_profiles jsonb:='[]'::jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  for v_row in
    select l.tenant_id,l.person_id,t.display_name as tenant_name,
      t.timezone,t.brand_theme,t.logo_object_path,t.branding_updated_at,
      p.display_name as person_name,p.patient_shared_note,p.updated_at
    from public.cithela_patient_links l
    join public.cithela_tenants t on t.id=l.tenant_id and t.status='active'
    join public.cithela_people p on p.tenant_id=l.tenant_id and p.id=l.person_id
    where l.user_id=v_actor order by t.display_name,p.display_name
  loop
    select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at desc),'[]'::jsonb)
      into v_items
    from (
      select id,starts_at,ends_at,status,service_name,duration_min,resource_name,
        reason,row_version,deposit_amount_minor,deposit_currency,deposit_status
      from public.cithela_appointments
      where tenant_id=v_row.tenant_id and person_id=v_row.person_id
      order by starts_at desc limit 100
    ) a;
    v_profiles:=v_profiles||jsonb_build_array(jsonb_build_object(
      'tenant_id',v_row.tenant_id,'tenant_name',v_row.tenant_name,
      'person_id',v_row.person_id,'name',v_row.person_name,
      'timezone',v_row.timezone,'appointments',v_items,
      'patient_shared_note',v_row.patient_shared_note,
      'person_updated_at',v_row.updated_at,
      'brand_theme',v_row.brand_theme,'logo_object_path',v_row.logo_object_path,
      'branding_updated_at',v_row.branding_updated_at
    ));
  end loop;
  return jsonb_build_object('ok',true,'profiles',v_profiles);
end $fn$;
