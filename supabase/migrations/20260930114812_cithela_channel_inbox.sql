create table public.cithela_channel_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
  connection_id uuid not null,
  channel text not null check (channel in ('whatsapp')),
  external_event_id text not null check (length(btrim(external_event_id)) between 1 and 300),
  sender_phone_e164 text not null check (sender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  sender_name text,
  message_type text not null check (length(btrim(message_type)) between 1 and 80),
  text_body text,
  provider_timestamp timestamptz,
  normalized_payload jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','processing','processed','ignored','failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (tenant_id,connection_id)
    references public.cithela_channel_connections(tenant_id,id) on delete cascade,
  constraint cithela_channel_inbox_sender_name_len
    check (sender_name is null or length(sender_name)<=160),
  constraint cithela_channel_inbox_text_len
    check (text_body is null or length(text_body)<=5000),
  constraint cithela_channel_inbox_payload_size
    check (octet_length(normalized_payload::text)<=65536),
  unique(channel,external_event_id)
);
create index cithela_channel_inbox_tenant_status_idx
  on public.cithela_channel_inbox(tenant_id,status,received_at);
create index cithela_channel_inbox_connection_idx
  on public.cithela_channel_inbox(tenant_id,connection_id,received_at);
alter table public.cithela_channel_inbox enable row level security;
revoke all on public.cithela_channel_inbox from anon,authenticated;

create function cithela_private.channel_ingest(
  p_channel text,
  p_external_account_id text,
  p_external_event_id text,
  p_sender_phone text,
  p_sender_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_normalized_payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_route jsonb;
  v_tenant_id uuid;
  v_connection_id uuid;
  v_channel text:=lower(btrim(coalesce(p_channel,'')));
  v_event_id text:=btrim(coalesce(p_external_event_id,''));
  v_phone text:=btrim(coalesce(p_sender_phone,''));
  v_name text:=nullif(btrim(coalesce(p_sender_name,'')),'');
  v_type text:=lower(btrim(coalesce(p_message_type,'')));
  v_body text:=p_text_body;
  v_payload jsonb:=coalesce(p_normalized_payload,'{}'::jsonb);
  v_row public.cithela_channel_inbox%rowtype;
begin
  if v_channel<>'whatsapp'
    or length(v_event_id) not between 1 and 300
    or v_phone !~ '^\+[1-9][0-9]{7,14}$'
    or length(v_type) not between 1 and 80
    or (v_name is not null and length(v_name)>160)
    or (v_body is not null and length(v_body)>5000)
    or jsonb_typeof(v_payload)<>'object'
    or octet_length(v_payload::text)>65536 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  v_route:=cithela_private.channel_route(v_channel,p_external_account_id);
  if coalesce((v_route->>'ok')::boolean,false) is not true then return v_route; end if;
  v_tenant_id:=(v_route->>'tenant_id')::uuid;
  v_connection_id:=(v_route->>'connection_id')::uuid;

  insert into public.cithela_channel_inbox(
    tenant_id,connection_id,channel,external_event_id,
    sender_phone_e164,sender_name,message_type,text_body,
    provider_timestamp,normalized_payload
  ) values(
    v_tenant_id,v_connection_id,v_channel,v_event_id,
    v_phone,v_name,v_type,v_body,p_provider_timestamp,v_payload
  )
  on conflict (channel,external_event_id) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'ok',true,'code','event_ingested','duplicate',false,
      'event',jsonb_build_object(
        'id',v_row.id,'tenant_id',v_row.tenant_id,
        'connection_id',v_row.connection_id,'external_event_id',v_row.external_event_id,
        'status',v_row.status
      )
    );
  end if;

  select * into v_row from public.cithela_channel_inbox i
    where i.channel=v_channel and i.external_event_id=v_event_id;

  if v_row.tenant_id<>v_tenant_id
    or v_row.connection_id<>v_connection_id
    or v_row.sender_phone_e164<>v_phone
    or v_row.message_type<>v_type
    or v_row.text_body is distinct from v_body
    or v_row.normalized_payload is distinct from v_payload then
    return jsonb_build_object('ok',false,'code','event_conflict');
  end if;

  return jsonb_build_object(
    'ok',true,'code','event_duplicate','duplicate',true,
    'event',jsonb_build_object(
      'id',v_row.id,'tenant_id',v_row.tenant_id,
      'connection_id',v_row.connection_id,'external_event_id',v_row.external_event_id,
      'status',v_row.status
    )
  );
end $$;
revoke all on function cithela_private.channel_ingest(
  text,text,text,text,text,text,text,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function cithela_private.channel_ingest(
  text,text,text,text,text,text,text,timestamptz,jsonb
) to service_role;

create function public.cithela_channel_ingest(
  p_channel text,
  p_external_account_id text,
  p_external_event_id text,
  p_sender_phone text,
  p_sender_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_normalized_payload jsonb
) returns jsonb
language sql security invoker set search_path='' as $$
  select cithela_private.channel_ingest(
    p_channel,p_external_account_id,p_external_event_id,p_sender_phone,
    p_sender_name,p_message_type,p_text_body,p_provider_timestamp,p_normalized_payload
  );
$$;
revoke all on function public.cithela_channel_ingest(
  text,text,text,text,text,text,text,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.cithela_channel_ingest(
  text,text,text,text,text,text,text,timestamptz,jsonb
) to service_role;
