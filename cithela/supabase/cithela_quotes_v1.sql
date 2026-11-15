-- CITHELA Presupuestos v0.2 — revisión para migración FUTURA.
-- No aplicar en producción sin backup, revisión de RLS y tests reales.
-- No se modifica ninguna tabla existente ni ningún RPC actual.

create table if not exists public.cithela_quote_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  service_id uuid,
  name text not null check (length(btrim(name)) between 1 and 160),
  unit_minor bigint not null check (unit_minor between 0 and 100000000000),
  currency text not null default 'ARS' check (currency='ARS'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,service_id) references public.cithela_services(tenant_id,id)
);
create index if not exists cithela_quote_catalog_tenant_idx
  on public.cithela_quote_catalog(tenant_id,active,name);

create table if not exists public.cithela_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  person_id uuid not null,
  created_by uuid not null references auth.users(id),
  request_id text not null check(length(btrim(request_id)) between 8 and 150),
  reference text not null check(length(reference) between 3 and 50),
  status text not null default 'borrador'
    check (status in ('borrador','enviado','aceptado','rechazado')),
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 50),
  currency text not null default 'ARS' check(currency='ARS'),
  subtotal_minor bigint not null check(subtotal_minor between 0 and 100000000000),
  discount_minor bigint not null default 0 check(discount_minor between 0 and 100000000000),
  total_minor bigint not null check(total_minor between 0 and 100000000000),
  validity_days integer not null default 7 check(validity_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  unique (tenant_id,id),
  unique (tenant_id,request_id),
  unique (tenant_id,reference),
  foreign key (tenant_id,person_id) references public.cithela_people(tenant_id,id)
);
create index if not exists cithela_quotes_person_idx
  on public.cithela_quotes(tenant_id,person_id,created_at desc);
create index if not exists cithela_quotes_recent_idx
  on public.cithela_quotes(tenant_id,created_at desc);

-- Defensa en profundidad: se accede solo mediante RPC con permisos revisados.
alter table public.cithela_quote_catalog enable row level security;
alter table public.cithela_quotes enable row level security;
revoke all on public.cithela_quote_catalog from public,anon,authenticated;
revoke all on public.cithela_quotes from public,anon,authenticated;

create or replace function cithela_private.quote_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text; v_id uuid; v_person uuid;
  v_items jsonb := '[]'::jsonb; v_item jsonb; v_line jsonb;
  v_name text; v_quantity integer; v_price bigint; v_discount bigint:=0;
  v_subtotal bigint:=0; v_line_total bigint; v_validity integer:=7;
  v_existing public.cithela_quotes%rowtype;
  v_catalog public.cithela_quote_catalog%rowtype;
  v_expected timestamptz; v_status text; v_previous_status text; v_result jsonb;
  v_request text := btrim(coalesce(p_request_id,''));
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_tenant_id is null or length(v_request) not between 8 and 150 or
     p_payload is null or jsonb_typeof(p_payload)<>'object' or
     octet_length(p_payload::text)>32000 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command not in ('catalog.list','catalog.upsert','catalog.archive',
                      'quote.list','quote.save','quote.status') then
    return jsonb_build_object('ok',false,'code','unsupported_command');
  end if;
  select m.role into v_role from public.cithela_tenant_memberships m
   where m.tenant_id=p_tenant_id and m.user_id=v_actor;
  if v_role not in ('owner','admin','operator') or v_role is null then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  perform 1 from public.cithela_tenants t
   where t.id=p_tenant_id and t.status='active';
  if not found then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;

  if p_command='catalog.list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.name),'[]'::jsonb)
    into v_items from (
      select id,service_id,name,unit_minor,currency,active,updated_at
      from public.cithela_quote_catalog
      where tenant_id=p_tenant_id order by name limit 100
    ) q;
    return jsonb_build_object('ok',true,'catalog',v_items);
  end if;

  if p_command='quote.list' then
    begin
      v_person := nullif(p_payload->>'person_id','')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb)
    into v_items from (
      select q.id,q.person_id,p.display_name as patient_name,
        q.reference,q.status,q.currency,q.items,q.subtotal_minor,
        q.discount_minor,q.total_minor,q.validity_days,
        q.created_at,q.updated_at,q.sent_at,q.decided_at
      from public.cithela_quotes q
      join public.cithela_people p on p.tenant_id=q.tenant_id and p.id=q.person_id
      where q.tenant_id=p_tenant_id and (v_person is null or q.person_id=v_person)
      order by q.created_at desc limit 100
    ) q;
    return jsonb_build_object('ok',true,'quotes',v_items);
  end if;

  if p_command in ('catalog.upsert','catalog.archive') then
    if v_role not in ('owner','admin') then
      return jsonb_build_object('ok',false,'code','forbidden');
    end if;
    if (select count(*) from jsonb_object_keys(p_payload) as f(k)
      where k not in ('id','service_id','name','unit_minor'))>0 then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
    begin
      v_id := nullif(p_payload->>'id','')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
    if p_command='catalog.archive' then
      if v_id is null then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      update public.cithela_quote_catalog set active=false,updated_at=clock_timestamp()
        where tenant_id=p_tenant_id and id=v_id returning * into v_catalog;
      if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
      insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
      values(p_tenant_id,v_actor,'quote_catalog_archived','quote_catalog',v_catalog.id,'{}'::jsonb);
      return jsonb_build_object('ok',true,'code','archived','id',v_catalog.id);
    end if;
    v_name:=btrim(coalesce(p_payload->>'name',''));
    if length(v_name) not between 1 and 160 or
       jsonb_typeof(p_payload->'unit_minor') is distinct from 'number' or
       (p_payload->>'unit_minor') !~ '^[0-9]{1,12}$' then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
    v_price:=(p_payload->>'unit_minor')::bigint;
    if v_price>100000000000 then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    begin
      v_person := nullif(p_payload->>'service_id','')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
    if v_person is not null and not exists (
      select 1 from public.cithela_services s
       where s.tenant_id=p_tenant_id and s.id=v_person
    ) then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
    if v_id is null then
      if (select count(*) from public.cithela_quote_catalog where tenant_id=p_tenant_id)>=100 then
        return jsonb_build_object('ok',false,'code','catalog_limit');
      end if;
      insert into public.cithela_quote_catalog(tenant_id,service_id,name,unit_minor)
      values(p_tenant_id,v_person,v_name,v_price) returning * into v_catalog;
    else
      update public.cithela_quote_catalog
        set name=v_name,service_id=v_person,unit_minor=v_price,
            active=true,updated_at=clock_timestamp()
       where tenant_id=p_tenant_id and id=v_id returning * into v_catalog;
      if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
    end if;
    insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
      values(p_tenant_id,v_actor,'quote_catalog_saved','quote_catalog',v_catalog.id,
        jsonb_build_object('unit_minor',v_catalog.unit_minor));
    return jsonb_build_object('ok',true,'catalog_item',
      jsonb_build_object('id',v_catalog.id,'name',v_catalog.name,
        'unit_minor',v_catalog.unit_minor,'active',v_catalog.active));
  end if;

  if p_command='quote.save' then
    if (select count(*) from jsonb_object_keys(p_payload) as f(k)
      where k not in ('id','person_id','items','discount_minor','validity_days','expected_updated_at'))>0 then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
    if jsonb_typeof(p_payload->'person_id') is distinct from 'string' or
       jsonb_typeof(p_payload->'items') is distinct from 'array' or
       jsonb_array_length(p_payload->'items') not between 1 and 50 or
       (p_payload->>'discount_minor') !~ '^[0-9]{1,12}$' or
       (p_payload->>'validity_days') !~ '^[0-9]{1,2}$' then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
    begin
      v_person := (p_payload->>'person_id')::uuid;
      v_id := nullif(p_payload->>'id','')::uuid;
      v_discount := (p_payload->>'discount_minor')::bigint;
      v_validity := (p_payload->>'validity_days')::integer;
      v_expected := nullif(p_payload->>'expected_updated_at','')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
    if v_discount>100000000000 or v_validity not between 1 and 90 then
      return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    if not exists (select 1 from public.cithela_people
      where tenant_id=p_tenant_id and id=v_person) then
      return jsonb_build_object('ok',false,'code','person_not_found');
    end if;
    for v_item in select value from jsonb_array_elements(p_payload->'items') loop
      if jsonb_typeof(v_item)<>'object' or
         (select count(*) from jsonb_object_keys(v_item) as k(key)
            where key not in ('name','quantity','unit_minor'))>0 or
         jsonb_typeof(v_item->'name') is distinct from 'string' or
         jsonb_typeof(v_item->'quantity') is distinct from 'number' or
         jsonb_typeof(v_item->'unit_minor') is distinct from 'number' or
         (v_item->>'quantity') !~ '^[0-9]{1,2}$' or
         (v_item->>'unit_minor') !~ '^[0-9]{1,12}$' then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end if;
      v_name:=btrim(v_item->>'name');
      v_quantity:=(v_item->>'quantity')::integer;
      v_price:=(v_item->>'unit_minor')::bigint;
      if length(v_name) not between 1 and 160 or v_quantity not between 1 and 99
        or v_price>100000000000 then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end if;
      v_line_total:=v_price*v_quantity;
      v_subtotal:=v_subtotal+v_line_total;
      if v_subtotal>100000000000 then
        return jsonb_build_object('ok',false,'code','amount_limit');
      end if;
      v_line:=jsonb_build_object('name',v_name,'quantity',v_quantity,
        'unit_minor',v_price,'total_minor',v_line_total);
      v_items:=v_items||jsonb_build_array(v_line);
    end loop;
    if v_discount>v_subtotal then
      return jsonb_build_object('ok',false,'code','discount_exceeds_subtotal');
    end if;
    if v_id is null then
      -- Request ID provides idempotency for retries (concurrent requests may hit unique constraint).
      select * into v_existing from public.cithela_quotes
       where tenant_id=p_tenant_id and request_id=v_request;
      if found then
        if v_existing.person_id<>v_person or v_existing.items<>v_items
           or v_existing.discount_minor<>v_discount or v_existing.validity_days<>v_validity then
           return jsonb_build_object('ok',false,'code','idempotency_conflict');
        end if;
        return jsonb_build_object('ok',true,'code','replayed','id',v_existing.id,
          'reference',v_existing.reference,'updated_at',v_existing.updated_at);
      end if;
      v_id:=gen_random_uuid();
      insert into public.cithela_quotes(
        id,tenant_id,person_id,created_by,request_id,reference,items,
        subtotal_minor,discount_minor,total_minor,validity_days)
      values (v_id,p_tenant_id,v_person,v_actor,v_request,
        'P-'||upper(substr(replace(v_id::text,'-',''),1,20)),
        v_items,v_subtotal,v_discount,v_subtotal-v_discount,v_validity)
      returning * into v_existing;
    else
      if v_expected is null then return jsonb_build_object('ok',false,'code','missing_version'); end if;
      select * into v_existing from public.cithela_quotes
        where tenant_id=p_tenant_id and id=v_id for update;
      if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
      if v_existing.status<>'borrador' then
        return jsonb_build_object('ok',false,'code','quote_immutable');
      end if;
      if v_existing.updated_at<>v_expected then
        return jsonb_build_object('ok',false,'code','stale_write'); end if;
      update public.cithela_quotes
         set person_id=v_person,items=v_items,subtotal_minor=v_subtotal,
          discount_minor=v_discount,total_minor=v_subtotal-v_discount,
          validity_days=v_validity,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
       where tenant_id=p_tenant_id and id=v_id returning * into v_existing;
    end if;
    insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
      values(p_tenant_id,v_actor,'quote_saved','quote',v_existing.id,
        jsonb_build_object('person_id',v_existing.person_id,
          'status',v_existing.status,'total_minor',v_existing.total_minor));
    return jsonb_build_object('ok',true,'code','saved','id',v_existing.id,
      'reference',v_existing.reference,'status',v_existing.status,
      'updated_at',v_existing.updated_at,
      'total_minor',v_existing.total_minor);
  end if;

  if p_command='quote.status' then
    if (select count(*) from jsonb_object_keys(p_payload) as f(k)
      where k not in ('id','status','expected_updated_at'))>0 or
      jsonb_typeof(p_payload->'id') is distinct from 'string' or
      jsonb_typeof(p_payload->'status') is distinct from 'string' or
      jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
    begin
      v_id:=(p_payload->>'id')::uuid;
      v_expected:=(p_payload->>'expected_updated_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
    v_status:=p_payload->>'status';
    select * into v_existing from public.cithela_quotes
      where tenant_id=p_tenant_id and id=v_id for update;
    if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
    if v_existing.updated_at<>v_expected then
      return jsonb_build_object('ok',false,'code','stale_write'); end if;
    v_previous_status:=v_existing.status;
    if not (
      (v_existing.status='borrador' and v_status in ('enviado','rechazado')) or
      (v_existing.status='enviado' and v_status in ('aceptado','rechazado'))
    ) then return jsonb_build_object('ok',false,'code','invalid_transition'); end if;
    update public.cithela_quotes
      set status=v_status,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond'),
          sent_at=case when v_status='enviado' then now() else sent_at end,
          decided_at=case when v_status in ('aceptado','rechazado') then now() else decided_at end
      where tenant_id=p_tenant_id and id=v_id returning * into v_existing;
    insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
      values(p_tenant_id,v_actor,'quote_status_changed','quote',v_existing.id,
        jsonb_build_object('previous',v_previous_status,'next',v_existing.status));
    return jsonb_build_object('ok',true,'code','status_updated','id',v_existing.id,
      'status',v_existing.status,'updated_at',v_existing.updated_at);
  end if;
  return jsonb_build_object('ok',false,'code','unsupported_command');
exception when unique_violation then
  return jsonb_build_object('ok',false,'code','conflict_retry');
end $fn$;

create or replace function public.cithela_quote_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb default '{}'::jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.quote_command(p_tenant_id,p_request_id,p_command,p_payload);
$fn$;
revoke all on function cithela_private.quote_command(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.cithela_quote_command(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function cithela_private.quote_command(uuid,text,text,jsonb) to authenticated;
grant execute on function public.cithela_quote_command(uuid,text,text,jsonb) to authenticated;
