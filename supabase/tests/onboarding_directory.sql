-- Run with the database owner. Entire fixture rolls back.
begin;
do $$
declare
  owner_u uuid:=gen_random_uuid();
  viewer_u uuid:=gen_random_uuid();
  answer jsonb;
  replay jsonb;
  v_tenant uuid;
  person_id uuid;
  n integer;
begin
  insert into auth.users(id) values(owner_u),(viewer_u);

  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  execute 'set local role authenticated';

  answer:=public.cithela_bootstrap_tenant('Consultorio Prueba','America/Argentina/Buenos_Aires');
  if answer->>'code' is distinct from 'workspace_created' then raise exception 'bootstrap failed: %',answer; end if;
  v_tenant:=(answer#>>'{tenant,id}')::uuid;

  replay:=public.cithela_bootstrap_tenant('Segundo','America/Argentina/Buenos_Aires');
  if replay->>'code' is distinct from 'workspace_exists' then raise exception 'second bootstrap created tenant: %',replay; end if;

  execute 'reset role';
  select count(*) into n from public.cithela_tenants t where t.display_name in ('Consultorio Prueba','Segundo');
  if n is distinct from 1 then raise exception 'unexpected tenant count: %',n; end if;
  select count(*) into n from public.cithela_services s where s.tenant_id=v_tenant;
  if n is distinct from 1 then raise exception 'default service missing'; end if;
  select count(*) into n from public.cithela_resources r where r.tenant_id=v_tenant;
  if n is distinct from 1 then raise exception 'default resource missing'; end if;

  execute 'set local role authenticated';
  answer:=public.cithela_directory_command(
    v_tenant,'person-create','person.resolve',
    jsonb_build_object('phone','+5492215551234','name','Ana Prueba','create_if_missing',true)
  );
  if answer->>'code' is distinct from 'person_created' then raise exception 'person create failed: %',answer; end if;
  person_id:=(answer#>>'{person,id}')::uuid;

  replay:=public.cithela_directory_command(
    v_tenant,'person-create','person.resolve',
    jsonb_build_object('phone','+5492215551234','name','Ana Prueba','create_if_missing',true)
  );
  if replay->>'replayed' is distinct from 'true' then raise exception 'person replay failed: %',replay; end if;

  answer:=public.cithela_directory_command(
    v_tenant,'person-find','person.resolve',
    jsonb_build_object('phone','+5492215551234','create_if_missing',false)
  );
  if answer->>'code' is distinct from 'person_found'
     or (answer#>>'{person,id}')::uuid is distinct from person_id then
    raise exception 'person lookup failed: %',answer;
  end if;

  answer:=public.cithela_directory_command(
    v_tenant,'person-missing','person.resolve',
    jsonb_build_object('phone','+5492215559999','create_if_missing',false)
  );
  if answer->>'code' is distinct from 'person_not_found' then raise exception 'missing person result: %',answer; end if;

  execute 'reset role';
  insert into public.cithela_tenant_memberships(tenant_id,user_id,role) values(v_tenant,viewer_u,'viewer');
  perform set_config('request.jwt.claim.sub',viewer_u::text,true);
  execute 'set local role authenticated';

  answer:=public.cithela_directory_command(
    v_tenant,'viewer','person.resolve',
    jsonb_build_object('phone','+5492215551234','create_if_missing',false)
  );
  if answer->>'code' is distinct from 'forbidden' then raise exception 'viewer used directory command: %',answer; end if;

  execute 'reset role';
end $$;
rollback;
