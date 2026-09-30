-- Channel routing fixture. Entire transaction rolls back.
begin;
do $$
declare
  owner_u uuid:=gen_random_uuid();
  viewer_u uuid:=gen_random_uuid();
  other_u uuid:=gen_random_uuid();
  t1 uuid; t2 uuid; answer jsonb; n integer;
begin
  insert into auth.users(id) values(owner_u),(viewer_u),(other_u);
  insert into public.cithela_tenants(display_name) values('Channel A') returning id into t1;
  insert into public.cithela_tenants(display_name) values('Channel B') returning id into t2;
  insert into public.cithela_tenant_memberships values
    (t1,owner_u,'owner',now()),(t1,viewer_u,'viewer',now()),(t2,other_u,'owner',now());

  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  execute 'set local role authenticated';
  answer:=public.cithela_channel_configuration_command(
    t1,'bind-1','channel.bind',
    jsonb_build_object('channel','whatsapp','external_account_id','wa-phone-001','display_label','Principal')
  );
  if answer->>'code' is distinct from 'channel_bound' then raise exception 'bind failed: %',answer; end if;

  answer:=public.cithela_channel_configuration_command(
    t1,'bind-1','channel.bind',
    jsonb_build_object('channel','whatsapp','external_account_id','wa-phone-001','display_label','Principal')
  );
  if answer->>'replayed' is distinct from 'true' then raise exception 'replay failed: %',answer; end if;

  begin
    perform public.cithela_channel_route('whatsapp','wa-phone-001');
    raise exception 'authenticated client routed channel';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',viewer_u::text,true);
  select count(*) into n from public.cithela_channel_connections;
  if n is distinct from 0 then raise exception 'viewer saw channel connection'; end if;

  perform set_config('request.jwt.claim.sub',other_u::text,true);
  answer:=public.cithela_channel_configuration_command(
    t2,'bind-other','channel.bind',
    jsonb_build_object('channel','whatsapp','external_account_id','wa-phone-001')
  );
  if answer->>'code' is distinct from 'channel_already_bound' then raise exception 'cross-tenant duplicate accepted: %',answer; end if;

  execute 'reset role';
  execute 'set local role service_role';
  answer:=public.cithela_channel_route('whatsapp','wa-phone-001');
  if answer->>'code' is distinct from 'channel_routed'
     or (answer->>'tenant_id')::uuid is distinct from t1 then
    raise exception 'service route failed: %',answer;
  end if;
  execute 'reset role';
end $$;
rollback;
