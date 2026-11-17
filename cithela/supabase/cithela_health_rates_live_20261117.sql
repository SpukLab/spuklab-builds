-- CITHELA · Tarifas de consulta por cobertura (piloto opt-in)
-- Aditivo. No altera el alta de turnos existente, ni habilita tenants.
-- Requiere cithela_account_packages_20261117.sql previamente aplicado.

create table cithela_private.cithela_health_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id) on delete restrict,
  service_id uuid not null references public.cithela_services(id) on delete restrict,
  kind text not null check (kind in ('particular','obra_social','prepaga')),
  provider text not null default '' check (length(provider)<=80 and provider !~ '[[:cntrl:]]'),
  plan text not null default '' check (length(plan)<=80 and plan !~ '[[:cntrl:]]'),
  price_status text not null check(price_status in ('orientativo','a_confirmar')),
  amount_minor bigint check(amount_minor is null or amount_minor between 0 and 100000000000),
  valid_until date,
  active boolean not null default true,
  version bigint not null default 1 check(version>0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check ((kind='particular' and provider='' and plan='') or
         (kind in ('obra_social','prepaga') and length(btrim(provider)) between 2 and 80
                                            and length(btrim(plan)) between 1 and 80)),
  check ((price_status='orientativo' and amount_minor is not null) or
         (price_status='a_confirmar' and amount_minor is null))
);
create unique index cithela_health_rates_unique
 on cithela_private.cithela_health_rates
 (tenant_id,service_id,kind,lower(provider),lower(plan));
create index cithela_health_rates_tenant_service on cithela_private.cithela_health_rates(tenant_id,service_id);
alter table cithela_private.cithela_health_rates enable row level security;
revoke all on cithela_private.cithela_health_rates from public,anon,authenticated;

create table cithela_private.cithela_health_rate_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.cithela_tenants(id) on delete restrict,
  rate_id uuid not null references cithela_private.cithela_health_rates(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('create','update','archive','restore')),
  snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp()
);
alter table cithela_private.cithela_health_rate_audit enable row level security;
revoke all on cithela_private.cithela_health_rate_audit from public,anon,authenticated;

-- Módulo efectivo = disponible en catálogo global Y autorización específica
-- para el tenant Y agenda comercial vigente. Nunca habilitado por texto de rubro.
create or replace function cithela_private.cithela_health_ready(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists (
    select 1 from cithela_private.cithela_package_catalog c
    join cithela_private.cithela_tenant_package_access a on a.code=c.code
    join public.cithela_tenants t on t.id=a.tenant_id
    join public.cithela_public_booking_settings b on b.tenant_id=t.id
    where c.code='salud' and c.available
      and a.tenant_id=p_tenant_id and a.state in ('pilot','active')
      and (a.expires_at is null or a.expires_at>statement_timestamp())
      and t.status='active' and b.enabled=true
      and coalesce((cithela_private.commercial_entitlement_snapshot(t.id)->>'can_book')::boolean,false)
  );
$function$;
revoke all on function cithela_private.cithela_health_ready(uuid) from public,anon,authenticated;

-- Enlaces seleccionables. RLS administrativo permanece cerrado.
create or replace function public.cithela_health_my_accounts()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid();v_accounts jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'tenant_id',t.id,'name',t.display_name,'role',m.role)
    order by t.display_name),'[]'::jsonb) into v_accounts
  from public.cithela_tenant_memberships m
  join public.cithela_tenants t on t.id=m.tenant_id
  where m.user_id=v_actor and m.role in ('owner','admin') and t.status='active';
  return jsonb_build_object('ok',true,'accounts',v_accounts);
end
$function$;
revoke all on function public.cithela_health_my_accounts() from public,anon,authenticated;
grant execute on function public.cithela_health_my_accounts() to authenticated;

-- CRUD de reglas para dueño/administrador. Se pueden preparar borradores
-- ANTES de activar el módulo. No publica precios ni valida afiliaciones.
create or replace function public.cithela_health_rates_admin(
 p_tenant_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 v_actor uuid:=auth.uid();v_items jsonb;v_services jsonb;
 v_existing cithela_private.cithela_health_rates%rowtype;
 v_id uuid;v_service uuid;v_kind text;v_provider text;v_plan text;v_status text;
 v_active boolean;v_amount bigint;v_version bigint;v_end date;v_service_owner uuid;
 v_has_feature boolean;v_row cithela_private.cithela_health_rates%rowtype;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_tenant_id is null or not exists (
     select 1 from public.cithela_tenant_memberships m
     where m.user_id=v_actor and m.tenant_id=p_tenant_id and m.role in ('owner','admin')
  ) then return jsonb_build_object('ok',false,'code','forbidden');end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>3500
    then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
  v_has_feature:=cithela_private.cithela_health_ready(p_tenant_id);
  if p_action='list' then
    if p_payload<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'service_id',r.service_id,'kind',r.kind,
      'provider',r.provider,'plan',r.plan,'price_status',r.price_status,
      'amount_minor',r.amount_minor,'valid_until',r.valid_until,
      'active',r.active,'version',r.version)
      order by r.created_at,r.id),'[]'::jsonb)
      into v_items from cithela_private.cithela_health_rates r
      where r.tenant_id=p_tenant_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'duration_min',s.duration_min,
      'active',s.active) order by s.name),'[]'::jsonb) into v_services
      from public.cithela_services s where s.tenant_id=p_tenant_id and s.active;
    return jsonb_build_object('ok',true,'rates',v_items,
      'services',v_services,'enabled',v_has_feature);
  end if;
  if p_action not in ('upsert','archive','restore') then
    return jsonb_build_object('ok',false,'code','unknown_action');end if;
  if (select count(*) from jsonb_object_keys(p_payload) as f(k)
     where k not in ('id','service_id','kind','provider','plan','price_status',
                     'amount_minor','valid_until','expected_version'))>0 then
     return jsonb_build_object('ok',false,'code','invalid_payload');end if;
  if coalesce(p_payload->>'expected_version','') !~ '^(0|[1-9][0-9]{0,10})$' then
    return jsonb_build_object('ok',false,'code','invalid_version');end if;
  v_version:=(p_payload->>'expected_version')::bigint;
  if p_payload?'id' and jsonb_typeof(p_payload->'id')<>'null' then
    if (p_payload->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then return jsonb_build_object('ok',false,'code','invalid_id');end if;
    v_id:=(p_payload->>'id')::uuid;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('health_rate:'||p_tenant_id::text,0));
  if v_id is not null then
    select * into v_existing from cithela_private.cithela_health_rates r
      where r.id=v_id and r.tenant_id=p_tenant_id for update;
    if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
    if v_existing.version<>v_version then return jsonb_build_object('ok',false,'code','stale_write');end if;
  elsif v_version<>0 or p_action<>'upsert' then
    return jsonb_build_object('ok',false,'code','invalid_version');
  end if;
  if p_action in ('archive','restore') then
    if p_payload - 'id' - 'expected_version'<>'{}'::jsonb then
      return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    update cithela_private.cithela_health_rates r set
       active=(p_action='restore'),version=r.version+1,
       updated_at=statement_timestamp(),updated_by=v_actor
      where r.id=v_id and r.tenant_id=p_tenant_id returning * into v_row;
  else
    if coalesce(p_payload->>'service_id','') !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then return jsonb_build_object('ok',false,'code','invalid_service');end if;
    v_service:=(p_payload->>'service_id')::uuid;
    if not exists (select 1 from public.cithela_services s
      where s.id=v_service and s.tenant_id=p_tenant_id and s.active)
      then return jsonb_build_object('ok',false,'code','invalid_service');end if;
    v_kind:=p_payload->>'kind';
    v_provider:=btrim(coalesce(p_payload->>'provider',''));
    v_plan:=btrim(coalesce(p_payload->>'plan',''));
    v_status:=p_payload->>'price_status';
    if v_kind is null or v_kind not in ('particular','obra_social','prepaga')
      or length(v_provider)>80 or length(v_plan)>80
      or v_provider~'[[:cntrl:]]' or v_plan~'[[:cntrl:]]'
      or (v_kind='particular' and (v_provider<>'' or v_plan<>''))
      or (v_kind<>'particular' and (length(v_provider)<2 or length(v_plan)<1))
      or v_status is null or v_status not in ('orientativo','a_confirmar')
    then return jsonb_build_object('ok',false,'code','invalid_rate');end if;
    if v_status='orientativo' then
      if jsonb_typeof(p_payload->'amount_minor')<>'number' or
         coalesce(p_payload->>'amount_minor','') !~ '^(0|[1-9][0-9]{0,11})$'
         then return jsonb_build_object('ok',false,'code','invalid_amount');end if;
      v_amount:=(p_payload->>'amount_minor')::bigint;
      if v_amount>100000000000 then return jsonb_build_object('ok',false,'code','invalid_amount');end if;
    elsif p_payload?'amount_minor' and jsonb_typeof(p_payload->'amount_minor')<>'null' then
      return jsonb_build_object('ok',false,'code','invalid_amount');
    end if;
    if p_payload?'valid_until' and jsonb_typeof(p_payload->'valid_until')<>'null' then
      begin v_end:=(p_payload->>'valid_until')::date;
      exception when others then return jsonb_build_object('ok',false,'code','invalid_date');end;
      if v_end<current_date or v_end>current_date+365*5 then
        return jsonb_build_object('ok',false,'code','invalid_date');end if;
    end if;
    if v_id is null then
      if (select count(*) from cithela_private.cithela_health_rates r
          where r.tenant_id=p_tenant_id)>=100
        then return jsonb_build_object('ok',false,'code','limit_reached');end if;
      begin
       insert into cithela_private.cithela_health_rates
       (tenant_id,service_id,kind,provider,plan,price_status,amount_minor,
         valid_until,updated_by)
       values(p_tenant_id,v_service,v_kind,v_provider,v_plan,v_status,v_amount,
         v_end,v_actor) returning * into v_row;
      exception when unique_violation then
       return jsonb_build_object('ok',false,'code','rate_exists');
      end;
    else
      begin
       update cithela_private.cithela_health_rates r set
        service_id=v_service,kind=v_kind,provider=v_provider,plan=v_plan,
        price_status=v_status,amount_minor=v_amount,valid_until=v_end,
        version=r.version+1,updated_at=statement_timestamp(),updated_by=v_actor
        where r.id=v_id and r.tenant_id=p_tenant_id returning * into v_row;
      exception when unique_violation then
       return jsonb_build_object('ok',false,'code','rate_exists');
      end;
    end if;
  end if;
  insert into cithela_private.cithela_health_rate_audit
    (tenant_id,rate_id,actor_id,action,snapshot)
  values(p_tenant_id,v_row.id,v_actor,
    case when p_action='upsert' then case when v_id is null then 'create' else 'update' end
     else p_action end,
    jsonb_build_object('version',v_row.version,'service_id',v_row.service_id,
      'kind',v_row.kind,'provider',v_row.provider,'plan',v_row.plan,
      'price_status',v_row.price_status,'amount_minor',v_row.amount_minor,
      'valid_until',v_row.valid_until,'active',v_row.active));
  return jsonb_build_object('ok',true,'code','saved','id',v_row.id,
    'version',v_row.version,'enabled',v_has_feature);
end
$function$;
revoke all on function public.cithela_health_rates_admin(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cithela_health_rates_admin(uuid,text,jsonb) to authenticated;

-- Lista pública de convenios exclusivamente para enlaces de reserva existentes,
-- con fecha de vigencia, sin identidad ni documentación de pacientes.
create or replace function public.cithela_health_public_rates(
 p_slug text,p_service_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_tenant uuid;v_tz text;v_prices jsonb;
begin
  if p_slug is null or p_slug!~'^[a-z0-9][a-z0-9-]{2,49}$' or p_service_id is null
    then return jsonb_build_object('ok',false,'code','not_found');end if;
  select t.id,t.timezone into v_tenant,v_tz
    from public.cithela_public_booking_settings b
    join public.cithela_tenants t on t.id=b.tenant_id
    join public.cithela_services s on s.tenant_id=t.id
    where b.slug=p_slug and b.enabled and t.status='active'
      and s.id=p_service_id and s.active;
  if v_tenant is null then return jsonb_build_object('ok',false,'code','not_found');end if;
  if not cithela_private.cithela_health_ready(v_tenant) then
    return jsonb_build_object('ok',true,'enabled',false,'rates','[]'::jsonb);end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'kind',r.kind,'provider',r.provider,'plan',r.plan,
    'price_status',r.price_status,'amount_minor',r.amount_minor,
    'version',r.version,'valid_until',r.valid_until)
    order by r.kind,r.provider,r.plan),'[]'::jsonb) into v_prices
    from cithela_private.cithela_health_rates r
    where r.tenant_id=v_tenant and r.service_id=p_service_id and r.active
      and (r.valid_until is null or r.valid_until >= (statement_timestamp() at time zone v_tz)::date);
  return jsonb_build_object('ok',true,'enabled',true,'rates',v_prices);
end
$function$;
revoke all on function public.cithela_health_public_rates(text,uuid) from public,anon,authenticated;
grant execute on function public.cithela_health_public_rates(text,uuid) to anon,authenticated;

-- Selección y precio SOLO informativos. Nunca procesa autorizaciones ni cobros.
create table cithela_private.cithela_health_booking_selections (
  appointment_id uuid primary key references public.cithela_appointments(id) on delete restrict,
  tenant_id uuid not null references public.cithela_tenants(id) on delete restrict,
  rate_id uuid not null references cithela_private.cithela_health_rates(id) on delete restrict,
  rate_version bigint not null check(rate_version>0),
  kind text not null check(kind in ('particular','obra_social','prepaga')),
  provider text not null default '',
  plan text not null default '',
  price_status text not null check(price_status in ('orientativo','a_confirmar')),
  amount_minor bigint check(amount_minor is null or amount_minor between 0 and 100000000000),
  saved_at timestamptz not null default statement_timestamp()
);
create index cithela_health_bookings_tenant on cithela_private.cithela_health_booking_selections(tenant_id,saved_at);
alter table cithela_private.cithela_health_booking_selections enable row level security;
revoke all on cithela_private.cithela_health_booking_selections from public,anon,authenticated;

-- Adapta la reserva existente sin modificarla. Si la función interna falla,
-- no debe persistir selección ni cobro. Si la selección falla, toda la
-- transacción revierte. Se respeta la idempotencia del pedido original.
create or replace function public.cithela_health_booking_create(
 p_tenant_id uuid,p_request_id text,p_payload jsonb,
 p_rate_id uuid,p_rate_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid();v_service uuid;v_timezone text;v_rate cithela_private.cithela_health_rates%rowtype;
  v_response jsonb;v_appointment uuid;v_selection cithela_private.cithela_health_booking_selections%rowtype;
begin
 if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
 if p_tenant_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_rate_id is null or p_rate_version is null or p_rate_version<1 then
   return jsonb_build_object('ok',false,'code','invalid_rate');end if;
 if coalesce(p_payload->>'service_id','')!~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then return jsonb_build_object('ok',false,'code','invalid_service');end if;
 v_service:=(p_payload->>'service_id')::uuid;
 select timezone into v_timezone from public.cithela_tenants t where t.id=p_tenant_id;
 if v_timezone is null then return jsonb_build_object('ok',false,'code','tenant_inactive');end if;
 if not cithela_private.cithela_health_ready(p_tenant_id) then
   return jsonb_build_object('ok',false,'code','module_not_enabled');end if;
 select * into v_rate from cithela_private.cithela_health_rates r
   where r.id=p_rate_id and r.tenant_id=p_tenant_id and r.service_id=v_service
     and r.active for share;
 if not found or v_rate.version<>p_rate_version or
    (v_rate.valid_until is not null and v_rate.valid_until<
       (statement_timestamp() at time zone v_timezone)::date) then
   return jsonb_build_object('ok',false,'code','rate_changed');end if;
 -- La rutina existente verifica email/teléfono, vínculo, disponibilidad, tenant,
 -- duplicados e idempotencia. No se confía en un importe enviado por el navegador.
 v_response:=cithela_private.patient_booking_create(p_tenant_id,p_request_id,p_payload);
 if not coalesce((v_response->>'ok')::boolean,false) then return v_response;end if;
 v_appointment:=(v_response->'appointment'->>'id')::uuid;
 if v_appointment is null then raise exception 'booking_response_missing_appointment';end if;
 if coalesce((v_response->>'replayed')::boolean,false) then
   select * into v_selection from cithela_private.cithela_health_booking_selections s
     where s.appointment_id=v_appointment and s.tenant_id=p_tenant_id;
   if not found or v_selection.rate_id<>p_rate_id
     or v_selection.rate_version<>p_rate_version then
     return jsonb_build_object('ok',false,'code','selection_conflict');end if;
 else
   insert into cithela_private.cithela_health_booking_selections
     (appointment_id,tenant_id,rate_id,rate_version,kind,provider,plan,price_status,amount_minor)
   values(v_appointment,p_tenant_id,v_rate.id,v_rate.version,v_rate.kind,
     v_rate.provider,v_rate.plan,v_rate.price_status,v_rate.amount_minor);
 end if;
 return v_response || jsonb_build_object(
   'coverage',jsonb_build_object('kind',v_rate.kind,'provider',v_rate.provider,
      'plan',v_rate.plan,'price_status',v_rate.price_status,
      'amount_minor',v_rate.amount_minor,'currency','ARS'));
end
$function$;
revoke all on function public.cithela_health_booking_create(uuid,text,jsonb,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.cithela_health_booking_create(uuid,text,jsonb,uuid,bigint) to authenticated;

-- El profesional lee sus snapshots sin exponerlos a otros tenants/pacientes.
create or replace function public.cithela_health_appointment_coverage(
 p_tenant_id uuid,p_appointment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
 if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
 if not exists(select 1 from public.cithela_tenant_memberships m
   where m.tenant_id=p_tenant_id and m.user_id=v_actor
     and m.role in ('owner','admin','operator')) then
   return jsonb_build_object('ok',false,'code','forbidden');end if;
 select jsonb_build_object('kind',s.kind,'provider',s.provider,'plan',s.plan,
   'price_status',s.price_status,'amount_minor',s.amount_minor,
   'currency','ARS','saved_at',s.saved_at) into v_result
   from cithela_private.cithela_health_booking_selections s
   where s.tenant_id=p_tenant_id and s.appointment_id=p_appointment_id;
 return jsonb_build_object('ok',true,'coverage',v_result);
end
$function$;
revoke all on function public.cithela_health_appointment_coverage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cithela_health_appointment_coverage(uuid,uuid) to authenticated;
