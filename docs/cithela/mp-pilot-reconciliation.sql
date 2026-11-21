create table if not exists cithela_private.cithela_mp_pilot_payments (
  payment_id text primary key,
  invoice_id text unique not null,
  intent_id uuid not null references cithela_private.cithela_mp_subscription_intents(intent_id),
  approved_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp()
);
create table if not exists cithela_private.cithela_mp_pilot_activations (
  intent_id uuid primary key references cithela_private.cithela_mp_subscription_intents(intent_id),
  payment_id text unique not null references cithela_private.cithela_mp_pilot_payments(payment_id),
  activated_at timestamptz not null default statement_timestamp()
);
alter table cithela_private.cithela_mp_pilot_payments enable row level security;
alter table cithela_private.cithela_mp_pilot_activations enable row level security;
revoke all on cithela_private.cithela_mp_pilot_payments, cithela_private.cithela_mp_pilot_activations
  from public, anon, authenticated;

-- Only call after verifying all three provider resources with the test credential.
-- Pilot activation is isolated from commercial access and cannot alter entitlements.
create or replace function public.cithela_mp_reconcile_pilot_payment(
  p_subscription_id text, p_invoice_id text, p_payment_id text, p_approved_at timestamptz,
  p_collector_id text, p_amount_minor bigint
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pilot constant uuid := 'e680ebd3-a031-4968-905a-e829ab3b5dfe';
  intent cithela_private.cithela_mp_subscription_intents%rowtype;
  activated boolean;
begin
  if p_invoice_id is null or p_invoice_id !~ '^[0-9]{1,30}$'
    or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
    or p_approved_at is null or not isfinite(p_approved_at)
    or p_approved_at > now() + interval '5 minutes' then
    return jsonb_build_object('ok',false,'code','invalid_payment_evidence');
  end if;

  select * into intent from cithela_private.cithela_mp_subscription_intents i
  where i.tenant_id = pilot and i.provider_subscription_id = p_subscription_id
    and i.stage = 'linked' and i.live_mode = false and i.currency_id = 'ARS'
    and i.terms_version = 'internal-test-only-v1'
    and i.collector_id = p_collector_id and i.amount_minor = p_amount_minor
    and i.opted_in_at <= p_approved_at
  for update;
  if not found then return jsonb_build_object('ok',false,'code','intent_mismatch'); end if;

  if not exists (
    select 1 from cithela_private.cithela_mp_webhook_inbox e
    where e.topic = 'subscription_authorized_payment' and e.resource_id = p_invoice_id
      and e.merchant_user_id = intent.collector_id and e.live_mode = false
  ) then return jsonb_build_object('ok',false,'code','signed_event_required'); end if;

  insert into cithela_private.cithela_mp_pilot_payments(payment_id,invoice_id,intent_id,approved_at)
  values(p_payment_id,p_invoice_id,intent.intent_id,p_approved_at)
  on conflict do nothing;
  if not found then
    if exists(select 1 from cithela_private.cithela_mp_pilot_payments p
      where p.payment_id=p_payment_id and p.invoice_id=p_invoice_id and p.intent_id=intent.intent_id
        and p.approved_at=p_approved_at)
    then return jsonb_build_object('ok',true,'code','already_reconciled'); end if;
    return jsonb_build_object('ok',false,'code','payment_identity_conflict');
  end if;

  insert into cithela_private.cithela_mp_pilot_activations(intent_id,payment_id)
  values(intent.intent_id,p_payment_id) on conflict (intent_id) do nothing;
  activated := found;
  return jsonb_build_object('ok',true,'code',case when activated then 'pilot_activated'
    else 'payment_recorded' end);
end;
$$;
revoke all on function public.cithela_mp_reconcile_pilot_payment(text,text,text,timestamptz,text,bigint)
  from public, anon, authenticated;
grant execute on function public.cithela_mp_reconcile_pilot_payment(text,text,text,timestamptz,text,bigint)
  to service_role;

create or replace function public.cithela_mp_pilot_reconciliation_intent(p_subscription_id text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('provider_subscription_id',i.provider_subscription_id,
    'external_reference',i.external_reference,'collector_id',i.collector_id,
    'currency_id',i.currency_id,'amount_minor',i.amount_minor,'live_mode',i.live_mode,
    'stage',i.stage)
  from cithela_private.cithela_mp_subscription_intents i
  where i.tenant_id='e680ebd3-a031-4968-905a-e829ab3b5dfe'
    and i.provider_subscription_id=p_subscription_id and i.stage='linked' and not i.live_mode
$$;
revoke all on function public.cithela_mp_pilot_reconciliation_intent(text)
  from public, anon, authenticated;
grant execute on function public.cithela_mp_pilot_reconciliation_intent(text) to service_role;
