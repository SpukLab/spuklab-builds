alter table public.cithela_channel_inbox
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column last_attempt_at timestamptz,
  add column lease_until timestamptz,
  add column lease_token uuid;

alter table public.cithela_channel_inbox
  add constraint cithela_channel_inbox_error_code_len
  check (error_code is null or length(error_code) <= 120);

create index cithela_channel_inbox_claim_idx
  on public.cithela_channel_inbox(status,lease_until,received_at);

create function cithela_private.channel_inbox_claim(
  p_limit integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,10),1),50);
  v_lease integer:=least(greatest(coalesce(p_lease_seconds,90),15),900);
  v_items jsonb;
begin
  with candidates as (
    select i.id
    from public.cithela_channel_inbox i
    join public.cithela_tenants t
      on t.id=i.tenant_id and t.status='active'
    join public.cithela_channel_connections c
      on c.id=i.connection_id
     and c.tenant_id=i.tenant_id
     and c.status='active'
    where i.status='new'
       or (i.status='processing' and i.lease_until < now())
    order by i.received_at,i.id
    for update of i skip locked
    limit v_limit
  ),
  claimed as (
    update public.cithela_channel_inbox i
       set status='processing',
           attempt_count=i.attempt_count+1,
           last_attempt_at=now(),
           lease_until=now()+make_interval(secs=>v_lease),
           lease_token=gen_random_uuid(),
           error_code=null
      from candidates c
     where i.id=c.id
     returning i.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'tenant_id',tenant_id,
        'connection_id',connection_id,
        'channel',channel,
        'external_event_id',external_event_id,
        'sender_phone',sender_phone_e164,
        'sender_name',sender_name,
        'message_type',message_type,
        'text_body',text_body,
        'provider_timestamp',provider_timestamp,
        'normalized_payload',normalized_payload,
        'attempt_count',attempt_count,
        'lease_until',lease_until,
        'lease_token',lease_token
      )
      order by received_at,id
    ),
    '[]'::jsonb
  ) into v_items
  from claimed;

  return jsonb_build_object(
    'ok',true,
    'code','events_claimed',
    'items',v_items
  );
end $$;

revoke all on function cithela_private.channel_inbox_claim(integer,integer)
  from public,anon,authenticated;
grant execute on function cithela_private.channel_inbox_claim(integer,integer)
  to service_role;

create function public.cithela_channel_inbox_claim(
  p_limit integer,
  p_lease_seconds integer
) returns jsonb
language sql security invoker set search_path='' as $$
  select cithela_private.channel_inbox_claim(p_limit,p_lease_seconds);
$$;

revoke all on function public.cithela_channel_inbox_claim(integer,integer)
  from public,anon,authenticated;
grant execute on function public.cithela_channel_inbox_claim(integer,integer)
  to service_role;

create function cithela_private.channel_inbox_complete(
  p_event_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_code text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_outcome text:=lower(btrim(coalesce(p_outcome,'')));
  v_error text:=nullif(btrim(coalesce(p_error_code,'')),'');
  v_row public.cithela_channel_inbox%rowtype;
begin
  if p_event_id is null
    or p_lease_token is null
    or v_outcome not in ('processed','ignored','failed')
    or (v_error is not null and length(v_error)>120) then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  select * into v_row
  from public.cithela_channel_inbox i
  where i.id=p_event_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'code','event_not_found');
  end if;

  if v_row.status<>'processing'
    or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_until is null
    or v_row.lease_until <= now() then
    return jsonb_build_object('ok',false,'code','stale_claim');
  end if;

  update public.cithela_channel_inbox
     set status=v_outcome,
         error_code=case when v_outcome='failed' then coalesce(v_error,'processing_failed') else null end,
         processed_at=now(),
         lease_until=null,
         lease_token=null
   where id=p_event_id
   returning * into v_row;

  return jsonb_build_object(
    'ok',true,
    'code','event_'||v_outcome,
    'event',jsonb_build_object(
      'id',v_row.id,
      'status',v_row.status,
      'attempt_count',v_row.attempt_count,
      'processed_at',v_row.processed_at,
      'error_code',v_row.error_code
    )
  );
end $$;

revoke all on function cithela_private.channel_inbox_complete(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function cithela_private.channel_inbox_complete(uuid,uuid,text,text)
  to service_role;

create function public.cithela_channel_inbox_complete(
  p_event_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_code text
) returns jsonb
language sql security invoker set search_path='' as $$
  select cithela_private.channel_inbox_complete(
    p_event_id,p_lease_token,p_outcome,p_error_code
  );
$$;

revoke all on function public.cithela_channel_inbox_complete(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.cithela_channel_inbox_complete(uuid,uuid,text,text)
  to service_role;
