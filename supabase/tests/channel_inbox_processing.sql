-- Server-only inbox processing lifecycle. Entire transaction rolls back.
begin;
do $$
declare
  v_tenant uuid;
  v_conn uuid;
  v_ingest jsonb;
  v_claim1 jsonb;
  v_claim2 jsonb;
  v_done jsonb;
  v_stale jsonb;
  v_id uuid;
  v_token1 uuid;
  v_token2 uuid;
  v_attempt integer;
  v_count integer;
begin
  insert into public.cithela_tenants(display_name)
    values('Inbox Processing Test') returning id into v_tenant;
  insert into public.cithela_channel_connections(
    tenant_id,channel,external_account_id,display_label
  ) values(
    v_tenant,'whatsapp','wa-processing-test','Test'
  ) returning id into v_conn;

  execute 'set local role service_role';

  v_ingest:=public.cithela_channel_ingest(
    'whatsapp','wa-processing-test','evt-processing-001',
    '+5492215551111','Ana','text','Hola',
    statement_timestamp(),'{"kind":"message"}'::jsonb
  );
  if v_ingest->>'code'<>'event_ingested' then
    raise exception 'ingest failed: %',v_ingest;
  end if;

  v_claim1:=public.cithela_channel_inbox_claim(10,60);
  if v_claim1->>'code'<>'events_claimed'
     or jsonb_array_length(v_claim1->'items')<>1 then
    raise exception 'claim1 failed: %',v_claim1;
  end if;

  v_id:=(v_claim1#>>'{items,0,id}')::uuid;
  v_token1:=(v_claim1#>>'{items,0,lease_token}')::uuid;
  v_attempt:=(v_claim1#>>'{items,0,attempt_count}')::integer;
  if v_attempt<>1 then
    raise exception 'attempt1 unexpected: %',v_claim1;
  end if;

  v_stale:=public.cithela_channel_inbox_complete(
    v_id,gen_random_uuid(),'processed',null
  );
  if v_stale->>'code'<>'stale_claim' then
    raise exception 'wrong token accepted: %',v_stale;
  end if;

  update public.cithela_channel_inbox
     set lease_until=now()-interval '1 second'
   where id=v_id;

  v_claim2:=public.cithela_channel_inbox_claim(10,60);
  if jsonb_array_length(v_claim2->'items')<>1 then
    raise exception 'reclaim failed: %',v_claim2;
  end if;
  v_token2:=(v_claim2#>>'{items,0,lease_token}')::uuid;
  v_attempt:=(v_claim2#>>'{items,0,attempt_count}')::integer;
  if v_attempt<>2 or v_token2=v_token1 then
    raise exception 'reclaim token/attempt failed: %',v_claim2;
  end if;

  v_stale:=public.cithela_channel_inbox_complete(
    v_id,v_token1,'processed',null
  );
  if v_stale->>'code'<>'stale_claim' then
    raise exception 'old token accepted: %',v_stale;
  end if;

  v_done:=public.cithela_channel_inbox_complete(
    v_id,v_token2,'processed',null
  );
  if v_done->>'code'<>'event_processed'
     or v_done#>>'{event,status}'<>'processed'
     or (v_done#>>'{event,attempt_count}')::integer<>2 then
    raise exception 'completion failed: %',v_done;
  end if;

  v_claim1:=public.cithela_channel_inbox_claim(10,60);
  if jsonb_array_length(v_claim1->'items')<>0 then
    raise exception 'terminal event reclaimed: %',v_claim1;
  end if;

  execute 'reset role';
  execute 'set local role authenticated';

  begin
    perform public.cithela_channel_inbox_claim(1,60);
    raise exception 'authenticated claim accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.cithela_channel_inbox_complete(
      v_id,v_token2,'processed',null
    );
    raise exception 'authenticated complete accepted';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';

  select count(*) into v_count
  from public.cithela_channel_inbox
  where id=v_id and status='processed';
  if v_count<>1 then raise exception 'final row missing'; end if;
end $$;
rollback;
