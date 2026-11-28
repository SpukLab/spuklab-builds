-- Isolated pilot activation audit. Never used to grant booking access.
-- A genuine commercial activation needs a separate production payment path.
create table if not exists cithela_private.cithela_mp_activation_rehearsals (
 intent_id uuid primary key references cithela_private.cithela_mp_subscription_intents(intent_id) on delete restrict,
 payment_id text not null unique references cithela_private.cithela_mp_pilot_payments(payment_id) on delete restrict,
 event_id bigint not null unique references cithela_private.cithela_mp_webhook_inbox(id) on delete restrict,
 period_start timestamptz not null,
 simulated_period_end timestamptz not null,
 recorded_at timestamptz not null default statement_timestamp(),
 check(simulated_period_end>period_start)
);
alter table cithela_private.cithela_mp_activation_rehearsals enable row level security;
revoke all on cithela_private.cithela_mp_activation_rehearsals from public,anon,authenticated;
create or replace function cithela_private.cithela_mp_project_dentrix_activation(p_event_id bigint)
returns boolean language plpgsql security definer set search_path to '' as $fn$
begin
 insert into cithela_private.cithela_mp_activation_rehearsals(intent_id,payment_id,event_id,period_start,simulated_period_end)
 select i.intent_id,p.payment_id,w.id,p.approved_at,
  ((p.approved_at at time zone 'America/Argentina/Buenos_Aires')+interval '1 month') at time zone 'America/Argentina/Buenos_Aires'
 from cithela_private.cithela_mp_webhook_inbox w
 join cithela_private.cithela_mp_pilot_payments p on p.payment_id=w.resource_id
 join cithela_private.cithela_mp_pilot_payment_proofs pr on pr.payment_id=p.payment_id and pr.invoice_id=p.invoice_id and pr.intent_id=p.intent_id
 join cithela_private.cithela_mp_subscription_intents i on i.intent_id=p.intent_id
 where w.id=p_event_id and w.topic='payment' and w.processing_status='reconciled'
 and w.live_mode=true and w.merchant_user_id='3813812326'
 and pr.signed_event_received=true and pr.observed_live_mode=true
 and i.tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e' and i.stage='linked'
 and i.live_mode=false and i.amount_minor=100000 and i.currency_id='ARS'
 and i.collector_id=w.merchant_user_id and i.terms_version='internal-test-only-v1'
 and p.approved_at>=i.opted_in_at and w.occurred_at>=i.opted_in_at
 and w.occurred_at>=p.approved_at-interval '5 minutes'
 on conflict do nothing;
 return exists(select 1 from cithela_private.cithela_mp_activation_rehearsals a where a.event_id=p_event_id);
end $fn$;
revoke all on function cithela_private.cithela_mp_project_dentrix_activation(bigint) from public,anon,authenticated,service_role;
create or replace function cithela_private.cithela_mp_project_reconciled_event()
returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
 if new.processing_status='reconciled' and new.topic='payment' then
  perform cithela_private.cithela_mp_project_dentrix_activation(new.id);
 end if;
 return new;
end $fn$;
revoke all on function cithela_private.cithela_mp_project_reconciled_event() from public,anon,authenticated,service_role;
create trigger cithela_mp_rehearse_activation_after_reconcile
 after update of processing_status on cithela_private.cithela_mp_webhook_inbox
 for each row when (new.processing_status='reconciled')
 execute function cithela_private.cithela_mp_project_reconciled_event();
-- Replay existing verified evidence once; no new provider request or charge.
select cithela_private.cithela_mp_project_dentrix_activation(w.id)
from cithela_private.cithela_mp_webhook_inbox w
where w.processing_status='reconciled' and w.topic='payment';
