-- CITHELA / FORMULARIOS · revisión de seguridad, NO aplicar a producción.
-- Persistencia exclusiva de plantillas. NO existen envíos, respuestas, adjuntos
-- ni enlaces públicos en este cambio. Diseñado contra esquema CITHELA 2026-11-20.
begin;

create or replace function cithela_private.form_template_fields_valid(p_fields jsonb)
returns boolean
language plpgsql immutable
set search_path to ''
as $fn$
declare
  f jsonb; opt jsonb;
  v_id text; v_label text; v_type text;
  v_key text; v_ids text[] := '{}'::text[]; v_options text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) is distinct from 'array'
    or jsonb_array_length(p_fields)>15
    or octet_length(p_fields::text)>16000 then
    return false;
  end if;
  for f in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) is distinct from 'object'
      or not (f ?& array['id','label','type','required','options']) then
      return false;
    end if;
    for v_key in select jsonb_object_keys(f) loop
      if v_key not in ('id','label','type','required','options') then return false; end if;
    end loop;
    if jsonb_typeof(f->'id') is distinct from 'string'
      or jsonb_typeof(f->'label') is distinct from 'string'
      or jsonb_typeof(f->'type') is distinct from 'string'
      or jsonb_typeof(f->'required') is distinct from 'boolean'
      or jsonb_typeof(f->'options') is distinct from 'array' then
      return false;
    end if;
    v_id := f->>'id';
    v_label := btrim(f->>'label');
    v_type := f->>'type';
    if v_id !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
      or v_id=any(v_ids)
      or length(v_label) not between 1 and 120
      or v_label ~ '[[:cntrl:]]'
      or v_type not in ('text','textarea','select','checkbox') then
      return false;
    end if;
    v_ids := array_append(v_ids,v_id);
    if v_type='select' then
      if jsonb_array_length(f->'options') not between 2 and 12 then return false; end if;
      v_options := '{}'::text[];
      for opt in select value from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(opt) is distinct from 'string'
          or length(btrim(opt #>> '{}')) not between 1 and 80
          or (opt #>> '{}') ~ '[[:cntrl:]]'
          or lower(btrim(opt #>> '{}'))=any(v_options) then
          return false;
        end if;
        v_options := array_append(v_options,lower(btrim(opt #>> '{}')));
      end loop;
    elsif jsonb_array_length(f->'options') <> 0 then
      return false;
    end if;
  end loop;
  return true;
end
$fn$;

revoke all on function cithela_private.form_template_fields_valid(jsonb)
  from public,anon,authenticated;

create table if not exists cithela_private.cithela_form_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  service_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 120
    and title !~ '[[:cntrl:]]'),
  status text not null default 'draft' check(status in ('draft','published','archived')),
  version bigint not null default 1 check(version>=1),
  fields jsonb not null default '[]'::jsonb
    check(cithela_private.form_template_fields_valid(fields)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,service_id)
    references public.cithela_services(tenant_id,id),
  unique(tenant_id,id)
);

create unique index if not exists cithela_form_one_published_per_service
  on cithela_private.cithela_form_templates(tenant_id,service_id)
  where status='published';
create index if not exists cithela_form_templates_tenant_service
  on cithela_private.cithela_form_templates(tenant_id,service_id,updated_at desc);

alter table cithela_private.cithela_form_templates enable row level security;
revoke all on table cithela_private.cithela_form_templates
  from public,anon,authenticated;

-- API pública autorizada por membresía real y tenant activo.
-- Se mantiene en public exclusivamente la función; la tabla queda en privado.
create or replace function public.cithela_form_template_save(
  p_tenant_id uuid,p_service_id uuid,p_template_id uuid,
  p_expected_version bigint,p_title text,p_fields jsonb
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_row cithela_private.cithela_form_templates%rowtype;
  v_title text:=btrim(coalesce(p_title,''));
  v_event text;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if not exists (
    select 1 from public.cithela_tenant_memberships m
    join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=v_actor
      and m.role in ('owner','admin') and t.status='active'
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if p_service_id is null or not exists (
    select 1 from public.cithela_services s
    where s.id=p_service_id and s.tenant_id=p_tenant_id and s.active
  ) then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  if length(v_title) not between 1 and 120 or v_title ~ '[[:cntrl:]]'
    or not cithela_private.form_template_fields_valid(p_fields) then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_template_id is null then
    if p_expected_version is not null then
      return jsonb_build_object('ok',false,'code','invalid_version');
    end if;
    insert into cithela_private.cithela_form_templates (
      tenant_id,service_id,title,fields,created_by
    ) values (p_tenant_id,p_service_id,v_title,p_fields,v_actor)
    returning * into v_row;
    v_event:='form_template_created';
  else
    if p_expected_version is null or p_expected_version<1 then
      return jsonb_build_object('ok',false,'code','invalid_version');
    end if;
    select * into v_row from cithela_private.cithela_form_templates f
      where f.id=p_template_id and f.tenant_id=p_tenant_id
        and f.service_id=p_service_id for update;
    if not found then return jsonb_build_object('ok',false,'code','template_not_found'); end if;
    if v_row.status<>'draft' then
      return jsonb_build_object('ok',false,'code','published_is_immutable');
    end if;
    if v_row.version<>p_expected_version then
      return jsonb_build_object('ok',false,'code','stale_write');
    end if;
    update cithela_private.cithela_form_templates f
      set title=v_title,fields=p_fields,version=version+1,updated_at=clock_timestamp()
      where f.id=p_template_id and f.tenant_id=p_tenant_id
      returning * into v_row;
    v_event:='form_template_updated';
  end if;
  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values (p_tenant_id,v_actor,v_event,'form_template',v_row.id,
    jsonb_build_object('service_id',p_service_id,'version',v_row.version,
      'field_count',jsonb_array_length(v_row.fields)));
  return jsonb_build_object('ok',true,'code',v_event,'template',to_jsonb(v_row));
end
$fn$;

create or replace function public.cithela_form_template_set_status(
  p_tenant_id uuid,p_template_id uuid,p_expected_version bigint,p_action text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_row cithela_private.cithela_form_templates%rowtype;
  v_next text;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if not exists (
    select 1 from public.cithela_tenant_memberships m
    join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=v_actor
      and m.role in ('owner','admin') and t.status='active'
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if p_action not in ('publish','archive') or p_expected_version is null
    or p_expected_version<1 then
    return jsonb_build_object('ok',false,'code','invalid_action');
  end if;
  select * into v_row from cithela_private.cithela_form_templates f
    where f.tenant_id=p_tenant_id and f.id=p_template_id for update;
  if not found then return jsonb_build_object('ok',false,'code','template_not_found'); end if;
  if v_row.version<>p_expected_version then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  if p_action='publish' then
    if v_row.status<>'draft' or jsonb_array_length(v_row.fields)=0 then
      return jsonb_build_object('ok',false,'code','invalid_transition');
    end if;
    v_next:='published';
  else
    if v_row.status not in ('draft','published') then
      return jsonb_build_object('ok',false,'code','invalid_transition');
    end if;
    v_next:='archived';
  end if;
  begin
    update cithela_private.cithela_form_templates f
      set status=v_next,version=version+1,updated_at=clock_timestamp()
      where f.id=v_row.id and f.tenant_id=p_tenant_id
      returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('ok',false,'code','published_form_exists');
  end;
  insert into public.cithela_operational_events
    (tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
  values (p_tenant_id,v_actor,'form_template_'||v_next,'form_template',v_row.id,
    jsonb_build_object('service_id',v_row.service_id,'version',v_row.version));
  return jsonb_build_object('ok',true,'code','form_template_'||v_next,
    'template',to_jsonb(v_row));
end
$fn$;

create or replace function public.cithela_form_templates_list(
  p_tenant_id uuid,p_service_id uuid
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_forms jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if not exists (
    select 1 from public.cithela_tenant_memberships m
    join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=v_actor
      and m.role in ('owner','admin') and t.status='active'
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if p_service_id is null or not exists(
    select 1 from public.cithela_services s
    where s.id=p_service_id and s.tenant_id=p_tenant_id
  ) then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.updated_at desc),'[]'::jsonb)
    into v_forms
  from (
    select * from cithela_private.cithela_form_templates
      where tenant_id=p_tenant_id and service_id=p_service_id
      order by updated_at desc limit 100
  ) f;
  return jsonb_build_object('ok',true,'templates',v_forms);
end
$fn$;

-- Postgres otorga EXECUTE a PUBLIC por defecto: revocar explícitamente.
revoke all on function public.cithela_form_template_save(uuid,uuid,uuid,bigint,text,jsonb)
  from public,anon;
revoke all on function public.cithela_form_template_set_status(uuid,uuid,bigint,text)
  from public,anon;
revoke all on function public.cithela_form_templates_list(uuid,uuid)
  from public,anon;
grant execute on function public.cithela_form_template_save(uuid,uuid,uuid,bigint,text,jsonb)
  to authenticated;
grant execute on function public.cithela_form_template_set_status(uuid,uuid,bigint,text)
  to authenticated;
grant execute on function public.cithela_form_templates_list(uuid,uuid)
  to authenticated;
commit;
