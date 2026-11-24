-- CITHELA · paquetes por establecimiento / avisos de vencimiento
-- Añade estructura privada. NO modifica cuentas, pagos, reservas ni tiempos.
-- Requiere el esquema comercial existente y el gateway admin protegido.
-- Todos los módulos nuevos empiezan sin habilitación técnica.

create table if not exists cithela_private.cithela_package_catalog (
  code text primary key check(code in ('presupuestos','salud','taxes','sms')),
  label text not null check(length(label) between 3 and 80),
  summary text not null check(length(summary) between 10 and 240),
  available boolean not null default false,
  price_ars_minor bigint check(price_ars_minor is null or price_ars_minor between 100 and 100000000000),
  price_usd_minor bigint check(price_usd_minor is null or price_usd_minor between 100 and 100000000000),
  price_published boolean not null default false check(price_published=false),
  updated_at timestamptz not null default now()
);
insert into cithela_private.cithela_package_catalog(code,label,summary) values
 ('presupuestos','Presupuestos','Presupuestos de tratamientos y servicios por establecimiento'),
 ('salud','Coberturas de salud','Obra social, prepaga y precio orientativo al solicitar consultas'),
 ('taxes','Tax services (EE. UU.)','Agenda de asesoramiento fiscal; no calcula impuestos ni procesa formularios'),
 ('sms','SMS (EE. UU.)','Canal opcional; requiere proveedor y consentimiento antes de activar')
on conflict(code) do nothing;
alter table cithela_private.cithela_package_catalog enable row level security;
revoke all on cithela_private.cithela_package_catalog from public,anon,authenticated;

create table if not exists cithela_private.cithela_tenant_package_access (
  tenant_id uuid not null references public.cithela_tenants(id) on delete restrict,
  code text not null references cithela_private.cithela_package_catalog(code),
  state text not null default 'requested'
     check(state in ('requested','pilot','active','disabled')),
  expires_at timestamptz,
  quoted_minor bigint check(quoted_minor is null or quoted_minor between 0 and 100000000000),
  quoted_currency text check(quoted_currency is null or quoted_currency in ('ARS','USD')),
  note text not null default '' check(length(note)<=240),
  updated_by uuid not null references auth.users(id),
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,code),
  check ((quoted_minor is null and quoted_currency is null) or
         (quoted_minor is not null and quoted_currency is not null)),
  check(expires_at is null or isfinite(expires_at))
);
alter table cithela_private.cithela_tenant_package_access enable row level security;
revoke all on cithela_private.cithela_tenant_package_access from public,anon,authenticated;

-- Todas las decisiones se registran. No se almacena ninguna afiliación ni dato de paciente.
create table if not exists cithela_private.cithela_package_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  tenant_id uuid not null references public.cithela_tenants(id),
  code text not null,
  state text not null,
  created_at timestamptz not null default statement_timestamp(),
  details jsonb not null default '{}'::jsonb
);
alter table cithela_private.cithela_package_admin_audit enable row level security;
revoke all on cithela_private.cithela_package_admin_audit from public,anon,authenticated;

create or replace function public.cithela_package_admin_command(
 p_actor uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_tenant uuid; v_code text; v_state text; v_version bigint;
  v_expiry timestamptz; v_money bigint; v_currency text; v_note text;
  v_record cithela_private.cithela_tenant_package_access%rowtype;
  v_catalog jsonb; v_grants jsonb; v_accounts jsonb;
  v_ready boolean;
begin
  -- Solo invocable por el servidor de administración con service_role.
  -- El Edge gateway confirma identidad y coincidencia exacta de UUID.
  if p_actor is null or not exists(
      select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
     ) then return jsonb_build_object('ok',false,'code','admin_not_verified'); end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
      or length(p_payload::text)>2200 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  if p_action='modules_read' then
    if p_payload<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'code',c.code,'label',c.label,'summary',c.summary,
      'available',c.available,'price_ars_minor',c.price_ars_minor,
      'price_usd_minor',c.price_usd_minor,
      'price_published',c.price_published
    ) order by c.code),'[]'::jsonb) into v_catalog
    from cithela_private.cithela_package_catalog c;
    select coalesce(jsonb_agg(jsonb_build_object(
      'tenant_id',g.tenant_id,'code',g.code,'state',g.state,
      'expires_at',g.expires_at,'quoted_minor',g.quoted_minor,
      'quoted_currency',g.quoted_currency,'note',g.note,
      'version',g.version,'updated_at',g.updated_at
    ) order by g.tenant_id,g.code),'[]'::jsonb) into v_grants
    from cithela_private.cithela_tenant_package_access g;
    -- Servidor determina fecha efectiva, sin borrar cuentas tras vencimiento.
    select coalesce(jsonb_agg(jsonb_build_object(
      'tenant_id',t.id,'name',t.display_name,'status',e.status,
      'can_book',coalesce((snap.info->>'can_book')::boolean,false),
      'expires_at',case snap.info->>'status'
         when 'complimentary' then snap.info->>'complimentary_until'
         when 'trialing' then snap.info->>'trial_ends_at'
         when 'active' then snap.info->>'current_period_end'
         else null end,
      'access_status',snap.info->>'status'
    ) order by t.created_at),'[]'::jsonb) into v_accounts
    from public.cithela_tenants t
    join cithela_private.cithela_commercial_entitlements e on e.tenant_id=t.id
    cross join lateral (select cithela_private.commercial_entitlement_snapshot(t.id) as info) snap;
    return jsonb_build_object('ok',true,'code','modules_snapshot',
      'catalog',v_catalog,'grants',v_grants,'accounts',v_accounts,
      'automatic_deletion',false,'whatsapp_automatic',false);
  end if;

  if p_action<>'modules_set' then return jsonb_build_object('ok',false,'code','unsupported_command'); end if;
  if (select count(*) from jsonb_object_keys(p_payload) as f(k)
      where k not in ('tenant_id','code','state','expires_at','quoted_minor',
                      'quoted_currency','note','expected_version'))>0 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if coalesce(p_payload->>'tenant_id','') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or jsonb_typeof(p_payload->'code')<>'string'
    or jsonb_typeof(p_payload->'state')<>'string'
    or jsonb_typeof(p_payload->'expected_version')<>'number'
    or coalesce(p_payload->>'expected_version','')!~ '^(0|[1-9][0-9]{0,10})$' then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  v_tenant:=(p_payload->>'tenant_id')::uuid;
  v_code:=p_payload->>'code';
  v_state:=p_payload->>'state';
  v_version:=(p_payload->>'expected_version')::bigint;
  if v_state not in ('requested','pilot','active','disabled')
    or not exists(select 1 from public.cithela_tenants t where t.id=v_tenant and t.status='active') then
    return jsonb_build_object('ok',false,'code','invalid_tenant_or_state');
  end if;
  select c.available into v_ready from cithela_private.cithela_package_catalog c
    where c.code=v_code for share;
  if not found then return jsonb_build_object('ok',false,'code','unknown_module');end if;
  if v_state in ('pilot','active') and v_ready is distinct from true then
    return jsonb_build_object('ok',false,'code','module_not_ready');
  end if;
  if p_payload?'expires_at' and jsonb_typeof(p_payload->'expires_at')<>'null' then
    begin v_expiry:=(p_payload->>'expires_at')::timestamptz;
    exception when others then return jsonb_build_object('ok',false,'code','invalid_expiry');end;
    if not isfinite(v_expiry) or v_expiry<=statement_timestamp()
       or v_expiry>statement_timestamp()+interval '5 years' then
      return jsonb_build_object('ok',false,'code','invalid_expiry');
    end if;
  end if;
  v_note:=btrim(coalesce(p_payload->>'note',''));
  if length(v_note)>240 or v_note ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok',false,'code','invalid_note'); end if;
  if p_payload?'quoted_minor' and jsonb_typeof(p_payload->'quoted_minor')<>'null' then
    if jsonb_typeof(p_payload->'quoted_minor')<>'number' or
      coalesce(p_payload->>'quoted_minor','')!~ '^(0|[1-9][0-9]{0,11})$' then
      return jsonb_build_object('ok',false,'code','invalid_price');end if;
    v_money:=(p_payload->>'quoted_minor')::bigint;
    if v_money>100000000000 then return jsonb_build_object('ok',false,'code','invalid_price');end if;
    v_currency:=p_payload->>'quoted_currency';
    if v_currency is null or v_currency not in ('ARS','USD') then
      return jsonb_build_object('ok',false,'code','invalid_currency');end if;
  elsif p_payload?'quoted_currency' and jsonb_typeof(p_payload->'quoted_currency')<>'null' then
    return jsonb_build_object('ok',false,'code','invalid_price');
  end if;
  -- Versionado con bloqueo por tenant + módulo para no pisar cambios simultáneos.
  perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text||'|'||v_code));
  select * into v_record from cithela_private.cithela_tenant_package_access g
    where g.tenant_id=v_tenant and g.code=v_code for update;
  if found then
    if v_record.version<>v_version then
      return jsonb_build_object('ok',false,'code','stale_write');end if;
    update cithela_private.cithela_tenant_package_access
       set state=v_state,expires_at=v_expiry,quoted_minor=v_money,
           quoted_currency=v_currency,note=v_note,updated_by=p_actor,
           version=version+1,updated_at=statement_timestamp()
       where tenant_id=v_tenant and code=v_code returning * into v_record;
  else
    if v_version<>0 then return jsonb_build_object('ok',false,'code','stale_write');end if;
    insert into cithela_private.cithela_tenant_package_access
      (tenant_id,code,state,expires_at,quoted_minor,quoted_currency,note,updated_by)
    values(v_tenant,v_code,v_state,v_expiry,v_money,v_currency,v_note,p_actor)
    returning * into v_record;
  end if;
  insert into cithela_private.cithela_package_admin_audit(actor_id,tenant_id,code,state,details)
   values(p_actor,v_tenant,v_code,v_state,jsonb_build_object(
     'version',v_record.version,'quoted_currency',v_currency,
     'quoted_minor',v_money,'expires_at',v_expiry));
  return jsonb_build_object('ok',true,'code','module_saved','tenant_id',v_tenant,
    'module_code',v_code,'state',v_state,'version',v_record.version);
end
$function$;
revoke all on function public.cithela_package_admin_command(uuid,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.cithela_package_admin_command(uuid,text,jsonb)
 to service_role;

-- Lectura para profesional; no concede acceso por tener el campo visible.
-- Estado de cuenta comercial y expiración de módulo se validan por separado.
create or replace function public.cithela_professional_packages(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $status$
declare v_actor uuid:=auth.uid();v_modules jsonb;v_access jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_tenant_id is null or not exists(
    select 1 from public.cithela_tenant_memberships m
     where m.tenant_id=p_tenant_id and m.user_id=v_actor
       and m.role in ('owner','admin','operator')
  ) then return jsonb_build_object('ok',false,'code','forbidden');end if;
  v_access:=cithela_private.commercial_entitlement_snapshot(p_tenant_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'code',c.code,'label',c.label,'state',coalesce(g.state,'disabled'),
    'expires_at',g.expires_at,
    'usable',coalesce((v_access->>'can_book')::boolean,false)
      and c.available and g.state in ('pilot','active')
      and (g.expires_at is null or g.expires_at>statement_timestamp())
  ) order by c.code),'[]'::jsonb) into v_modules
  from cithela_private.cithela_package_catalog c
  left join cithela_private.cithela_tenant_package_access g
    on g.code=c.code and g.tenant_id=p_tenant_id;
  return jsonb_build_object('ok',true,'modules',v_modules,
    'account_status',v_access->>'status','can_book',v_access->>'can_book',
    'trial_ends_at',v_access->>'trial_ends_at',
    'current_period_end',v_access->>'current_period_end',
    'complimentary_until',v_access->>'complimentary_until',
    'automatic_deletion',false);
end
$status$;
revoke all on function public.cithela_professional_packages(uuid) from public,anon,authenticated;
grant execute on function public.cithela_professional_packages(uuid) to authenticated;
