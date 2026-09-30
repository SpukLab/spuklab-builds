-- Server-only inbound channel inbox fixture. Entire transaction rolls back.
begin;
do $$
declare
  v_tenant uuid;
  v_conn uuid;
  v_first jsonb;
  v_dup jsonb;
  v_conflict jsonb;
  v_missing jsonb;
  v_n integer;
begin
  insert into public.cithela_tenants(display_name)
    values('Inbox Test') returning id into v_tenant;
  insert into public.cithela_channel_connections(
    tenant_id,channel,external_account_id,display_label
  ) values(
    v_tenant,'whatsapp','wa-inbox-test','Test'
  ) returning id into v_conn;

  execute 'set local role service_role';

  v_first:=public.cithela_channel_ingest(
    'whatsapp','wa-inbox-test','evt-001',
    '+5492215551111','Ana','text','Hola',
    statement_timestamp(),'{"kind":"message"}'::jsonb
  );
  if v_first->>'code' <> 'event_ingested'
     or v_first->>'duplicate' <> 'false'
     or (v_first#>>'{event,tenant_id}')::uuid is distinct from v_tenant
     or (v_first#>>'{event,connection_id}')::uuid is distinct from v_conn then
    raise exception 'first ingest failed: %',v_first;
  end if;

  v_dup:=public.cithela_channel_ingest(
    'whatsapp','wa-inbox-test','evt-001',
    '+5492215551111','Ana','text','Hola',
    statement_timestamp(),'{"kind":"message"}'::jsonb
  );
  if v_dup->>'code' <> 'event_duplicate'
     or v_dup->>'duplicate' <> 'true'
     or v_dup#>>'{event,id}' is distinct from v_first#>>'{event,id}' then
    raise exception 'duplicate replay failed: %',v_dup;
  end if;

  v_conflict:=public.cithela_channel_ingest(
    'whatsapp','wa-inbox-test','evt-001',
    '+5492215551111','Ana','text','Distinto',
    statement_timestamp(),'{"kind":"message"}'::jsonb
  );
  if v_conflict->>'code' <> 'event_conflict' then
    raise exception 'conflict failed: %',v_conflict;
  end if;

  v_missing:=public.cithela_channel_ingest(
    'whatsapp','wa-missing','evt-missing',
    '+5492215551111','Ana','text','Hola',
    statement_timestamp(),'{}'::jsonb
  );
  if v_missing->>'code' <> 'channel_not_found' then
    raise exception 'missing route failed: %',v_missing;
  end if;

  select count(*) into v_n
  from public.cithela_channel_inbox
  where tenant_id=v_tenant and external_event_id='evt-001';
  if v_n <> 1 then
    raise exception 'dedupe row count unexpected: %',v_n;
  end if;

  execute 'reset role';
  execute 'set local role authenticated';

  begin
    perform public.cithela_channel_ingest(
      'whatsapp','wa-inbox-test','evt-auth',
      '+5492215551111','Ana','text','Hola',
      statement_timestamp(),'{}'::jsonb
    );
    raise exception 'authenticated caller accepted ingest';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.cithela_channel_inbox limit 1;
    raise exception 'authenticated caller read inbox';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
end $$;
rollback;
