-- CITHELA: internal test-account provider-verified payment audit.
-- Never grants commercial entitlement; never substitutes for webhook evidence.
-- Contract: service_role only; single hardcoded Alma y Pampa internal pilot.
create table if not exists cithela_private.cithela_mp_pilot_payment_proofs (
 payment_id text primary key references cithela_private.cithela_mp_pilot_payments(payment_id) on delete restrict,
 invoice_id text not null unique,
 intent_id uuid not null references cithela_private.cithela_mp_subscription_intents(intent_id) on delete restrict,
 method text not null default 'test_accounts_provider_api_v1'
   check (method = 'test_accounts_provider_api_v1'),
 observed_live_mode boolean not null check (observed_live_mode = true),
 signed_event_received boolean not null default false,
 recorded_at timestamptz not null default statement_timestamp()
);
alter table cithela_private.cithela_mp_pilot_payment_proofs enable row level security;
revoke all on cithela_private.cithela_mp_pilot_payment_proofs from public,anon,authenticated;
grant select,insert on cithela_private.cithela_mp_pilot_payment_proofs to service_role;

create or replace function public.cithela_mp_record_test_account_verified_payment(
 p_subscription_id text, p_invoice_id text, p_payment_id text,
 p_approved_at timestamptz, p_collector_id text, p_amount_minor bigint,
 p_owner_user_id uuid, p_buyer_id text, p_observed_live_mode boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $func$
declare
 pilot constant uuid:='e680ebd3-a031-4968-905a-e829ab3b5dfe';
 seller constant text:='3813812326';
 buyer constant text:='3813812328';
 v cithela_private.cithela_mp_subscription_intents%rowtype;
 v_added text;
 v_old cithela_private.cithela_mp_pilot_payments%rowtype;
 v_proof cithela_private.cithela_mp_pilot_payment_proofs%rowtype;
begin
 if p_invoice_id is null or p_invoice_id !~ '^[0-9]{1,30}$'
   or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
   or p_subscription_id is null or p_subscription_id !~ '^[A-Za-z0-9_-]{1,100}$'
   or p_approved_at is null or not isfinite(p_approved_at)
   or p_approved_at > statement_timestamp()+interval '5 minutes'
   or p_collector_id is distinct from seller or p_amount_minor is distinct from 100000
   or p_buyer_id is distinct from buyer or p_observed_live_mode is distinct from true
 then return jsonb_build_object('ok',false,'code','invalid_test_payment_evidence'); end if;

 select * into v from cithela_private.cithela_mp_subscription_intents i
 where i.tenant_id=pilot and i.provider_subscription_id=p_subscription_id
   and i.owner_user_id=p_owner_user_id and i.collector_id=seller
   and i.stage='linked' and i.live_mode=false and i.currency_id='ARS'
   and i.amount_minor=100000 and i.terms_version='internal-test-only-v1'
   and i.opted_in_at<=p_approved_at
   and exists(
    select 1 from public.cithela_tenant_memberships m
    join cithela_private.cithela_commercial_entitlements e
      on e.tenant_id=m.tenant_id
    where m.tenant_id=pilot and m.user_id=p_owner_user_id
      and m.role='owner' and e.owner_user_id=p_owner_user_id
   ) for update;
 if not found then
  return jsonb_build_object('ok',false,'code','pilot_owner_intent_mismatch');
 end if;

 insert into cithela_private.cithela_mp_pilot_payments(
  payment_id,invoice_id,intent_id,approved_at
 ) values(p_payment_id,p_invoice_id,v.intent_id,p_approved_at)
 on conflict do nothing returning payment_id into v_added;
 if v_added is null then
  select * into v_old from cithela_private.cithela_mp_pilot_payments
   where payment_id=p_payment_id;
  select * into v_proof from cithela_private.cithela_mp_pilot_payment_proofs
   where payment_id=p_payment_id;
  if v_old.payment_id=p_payment_id and v_old.invoice_id=p_invoice_id
    and v_old.intent_id=v.intent_id and v_old.approved_at=p_approved_at
    and v_proof.payment_id=p_payment_id and v_proof.invoice_id=p_invoice_id
    and v_proof.intent_id=v.intent_id and v_proof.observed_live_mode=true
  then return jsonb_build_object('ok',true,'code','already_recorded_no_activation'); end if;
  return jsonb_build_object('ok',false,'code','payment_identity_conflict');
 end if;

 insert into cithela_private.cithela_mp_pilot_payment_proofs(
  payment_id,invoice_id,intent_id,observed_live_mode,signed_event_received
 ) values(p_payment_id,p_invoice_id,v.intent_id,true,
  exists(select 1 from cithela_private.cithela_mp_webhook_inbox e
   where e.topic='subscription_authorized_payment' and e.resource_id=p_invoice_id
     and e.merchant_user_id=seller and e.live_mode=true));
 -- Deliberately NO INSERT into cithela_mp_pilot_activations.
 return jsonb_build_object('ok',true,'code','test_payment_recorded_no_activation');
end
$func$;
revoke all on function public.cithela_mp_record_test_account_verified_payment(
 text,text,text,timestamptz,text,bigint,uuid,text,boolean
) from public,anon,authenticated;
grant execute on function public.cithela_mp_record_test_account_verified_payment(
 text,text,text,timestamptz,text,bigint,uuid,text,boolean
) to service_role;

-- Production activation remains forbidden for the internal-only pilot.
create or replace function cithela_private.cithela_mp_block_internal_test_activation()
returns trigger
language plpgsql
set search_path to ''
as $func$
begin
 if exists(select 1 from cithela_private.cithela_mp_subscription_intents i
  where i.intent_id=new.intent_id and i.tenant_id='e680ebd3-a031-4968-905a-e829ab3b5dfe'
    and i.terms_version='internal-test-only-v1')
 then
  raise exception 'internal_pilot_activation_blocked';
 end if;
 return new;
end $func$;
drop trigger if exists cithela_mp_internal_test_no_activation
 on cithela_private.cithela_mp_pilot_activations;
create trigger cithela_mp_internal_test_no_activation
 before insert on cithela_private.cithela_mp_pilot_activations
 for each row execute function cithela_private.cithela_mp_block_internal_test_activation();
