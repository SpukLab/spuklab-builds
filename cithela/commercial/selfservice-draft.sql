-- REVIEW ONLY. Not a production migration. Does NOT enforce operational access yet.
-- Apply only to a disposable fixture DB first. Existing pilot users are never enrolled.
-- SECURITY DEFINER is required for atomic bootstrap + private entitlement writes;
-- fixed search_path, explicit grants and verified auth are mandatory boundaries.
begin;
create table cithela_private.commercial_release (
  singleton boolean primary key default true check(singleton),
  signup_enabled boolean not null default false,
  terms_version text not null,
  privacy_version text not null
);
insert into cithela_private.commercial_release values(true,false,'DRAFT-NOT-ACCEPTABLE','DRAFT-NOT-ACCEPTABLE');
create table cithela_private.commercial_accounts (
  tenant_id uuid primary key references public.cithela_tenants(id),
  owner_user_id uuid not null unique references auth.users(id),
  status text not null check(status in ('trialing','trial_expired','payment_pending','active','past_due','canceled','suspended')),
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  current_period_end timestamptz,
  terms_version text not null,privacy_version text not null,
  accepted_at timestamptz not null,
  check(trial_ends_at=trial_started_at+interval '168 hours')
);
alter table cithela_private.commercial_release enable row level security;
alter table cithela_private.commercial_accounts enable row level security;
revoke all on cithela_private.commercial_release,cithela_private.commercial_accounts from public,anon,authenticated;

create function cithela_private.commercial_start(p_name text,p_terms text,p_privacy text)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare actor uuid:=auth.uid(); cfg cithela_private.commercial_release%rowtype;
  account cithela_private.commercial_accounts%rowtype; boot jsonb; tenant uuid; started timestamptz;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  -- Same actor lock as existing bootstrap; serializes simultaneous tabs/retries.
  perform 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null for update;
  if not found then return jsonb_build_object('ok',false,'code','verification_required'); end if;
  select * into account from cithela_private.commercial_accounts where owner_user_id=actor;
  if found then
    return jsonb_build_object('ok',true,'code','account_exists','tenant_id',account.tenant_id,
      'trial_ends_at',account.trial_ends_at); -- Retry never extends trial or overwrites consent.
  end if;
  select * into cfg from cithela_private.commercial_release where singleton;
  if cfg.signup_enabled is distinct from true then
    return jsonb_build_object('ok',false,'code','signup_disabled'); end if;
  if cfg.terms_version like 'DRAFT%' or cfg.privacy_version like 'DRAFT%'
    or p_terms is distinct from cfg.terms_version or p_privacy is distinct from cfg.privacy_version then
    return jsonb_build_object('ok',false,'code','consent_required'); end if;
  -- Never convert existing pilots or patient accounts implicitly.
  if exists(select 1 from public.cithela_tenant_memberships where user_id=actor)
    or exists(select 1 from public.cithela_patient_links where user_id=actor) then
    return jsonb_build_object('ok',false,'code','existing_account'); end if;
  boot:=cithela_private.bootstrap_tenant(p_name,'America/Argentina/Buenos_Aires');
  if boot->>'code' is distinct from 'workspace_created' then return boot; end if;
  tenant:=(boot->'tenant'->>'id')::uuid;
  started:=clock_timestamp();
  insert into cithela_private.commercial_accounts
    (tenant_id,owner_user_id,status,trial_started_at,trial_ends_at,terms_version,privacy_version,accepted_at)
    values(tenant,actor,'trialing',started,started+interval '168 hours',p_terms,p_privacy,started);
  return jsonb_build_object('ok',true,'code','trial_started','tenant_id',tenant,
    'trial_ends_at',started+interval '168 hours');
end $fn$;
create function cithela_private.commercial_status()
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare account cithela_private.commercial_accounts%rowtype; effective text; writable boolean:=false;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select * into account from cithela_private.commercial_accounts where owner_user_id=auth.uid();
  if not found then return jsonb_build_object('ok',false,'code','not_enrolled'); end if;
  effective:=account.status;
  if effective='trialing' and clock_timestamp()>=account.trial_ends_at then effective:='trial_expired'; end if;
  if effective='active' and (account.current_period_end is null or clock_timestamp()>=account.current_period_end) then effective:='past_due'; end if;
  writable:=(effective='trialing' or effective='active');
  return jsonb_build_object('ok',true,'status',effective,'tenant_id',account.tenant_id,
    'trial_ends_at',account.trial_ends_at,'current_period_end',account.current_period_end,
    'can_accept_bookings',writable,'server_now',clock_timestamp());
end $fn$;
-- Internal entitlement predicate for operational RPCs to call AFTER their own
-- tenant/role authorization checks. Never expose as a public RPC or use it
-- as a substitute for checking that the actor may operate on this tenant.
-- Legacy pilots intentionally have no commercial account: this predicate is
-- only for newly enrolled commercial tenants.
create function cithela_private.commercial_tenant_writable(p_tenant uuid)
returns boolean language sql stable security definer set search_path=''
as $fn$
  select exists (
    select 1 from cithela_private.commercial_accounts a
    where a.tenant_id = p_tenant
      and (
        (a.status = 'trialing' and now() < a.trial_ends_at)
        or
        (a.status = 'active' and a.current_period_end is not null
         and now() < a.current_period_end)
      )
  );
$fn$;
revoke all on function cithela_private.commercial_tenant_writable(uuid) from public,anon,authenticated;
-- Function owner can invoke this from authorized SECURITY DEFINER RPCs.
-- Do not grant direct execute on this predicate to client roles.

revoke all on function cithela_private.commercial_start(text,text,text),cithela_private.commercial_status() from public,anon,authenticated;
grant execute on function cithela_private.commercial_start(text,text,text),cithela_private.commercial_status() to authenticated;
-- Private schema is already used by existing wrappers; no new broad schema grants.
create function public.cithela_commercial_start(p_name text,p_terms text,p_privacy text)
returns jsonb language sql security invoker set search_path=''
as $fn$ select cithela_private.commercial_start(p_name,p_terms,p_privacy); $fn$;
create function public.cithela_commercial_status()
returns jsonb language sql security invoker set search_path=''
as $fn$ select cithela_private.commercial_status(); $fn$;
revoke all on function public.cithela_commercial_start(text,text,text),public.cithela_commercial_status() from public,anon,authenticated;
grant execute on function public.cithela_commercial_start(text,text,text),public.cithela_commercial_status() to authenticated;
commit;
-- BLOCKERS before release: prevent bypass via legacy bootstrap, enforce entitlement in
-- every booking/mutation RPC (including patient/channel), implement export/read policy,
-- payment ledger/reconciliation, invoice/cancel portal, actual A/B and restore tests.
-- Do NOT set signup_enabled=true with this draft alone.
