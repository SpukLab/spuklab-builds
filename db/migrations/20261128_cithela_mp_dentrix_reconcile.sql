-- Internal Dentrix reconciliation only. Provider GET evidence must precede this service-only RPC.
create or replace function public.cithela_mp_reconcile_dentrix_test(
 p_subscription_id text,p_invoice_id text,p_payment_id text,p_approved_at timestamptz,
 p_owner_user_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
 v cithela_private.cithela_mp_subscription_intents%rowtype;
 e cithela_private.cithela_mp_webhook_inbox%rowtype;
 existing cithela_private.cithela_mp_pilot_payments%rowtype;
 inserted text;
begin
 if p_subscription_id is null or p_subscription_id !~ '^[A-Za-z0-9_-]{1,100}$'
 or p_invoice_id is null or p_invoice_id !~ '^[0-9]{1,30}$'
 or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
 or p_approved_at is null or not isfinite(p_approved_at)
 or p_approved_at>statement_timestamp()+interval '5 minutes'
 then return jsonb_build_object('ok',false,'code','invalid_evidence'); end if;
 select i.* into v from cithela_private.cithela_mp_subscription_intents i
 where i.tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e' and i.owner_user_id=p_owner_user_id
 and i.provider_subscription_id=p_subscription_id and i.stage='linked' and i.live_mode=false
 and i.currency_id='ARS' and i.amount_minor=100000 and i.collector_id='3813812326'
 and i.terms_version='internal-test-only-v1' and i.opted_in_at<=p_approved_at
 and exists(select 1 from public.cithela_tenant_memberships m
 join cithela_private.cithela_commercial_entitlements ce on ce.tenant_id=m.tenant_id
 join auth.users u on u.id=m.user_id
 where m.tenant_id=i.tenant_id and m.user_id=i.owner_user_id and m.role='owner'
 and ce.owner_user_id=i.owner_user_id and lower(u.email)='dentrix.8m@gmail.com'
 and u.email_confirmed_at is not null) for update;
 if not found then return jsonb_build_object('ok',false,'code','intent_mismatch'); end if;
 select w.* into e from cithela_private.cithela_mp_webhook_inbox w
 where w.topic='payment' and w.resource_id=p_payment_id and w.merchant_user_id=v.collector_id
 and w.live_mode=true and w.occurred_at>=v.opted_in_at
 and w.occurred_at>=p_approved_at-interval '5 minutes'
 and w.occurred_at<=w.received_at+interval '5 minutes'
 and w.processing_status in ('received','reconciled')
 order by w.received_at limit 1 for update;
 if not found then return jsonb_build_object('ok',false,'code','signed_event_required'); end if;
 insert into cithela_private.cithela_mp_pilot_payments(payment_id,invoice_id,intent_id,approved_at)
 values(p_payment_id,p_invoice_id,v.intent_id,p_approved_at)
 on conflict do nothing returning payment_id into inserted;
 if inserted is null then
  select * into existing from cithela_private.cithela_mp_pilot_payments where payment_id=p_payment_id;
  if not found or existing.invoice_id is distinct from p_invoice_id or existing.intent_id is distinct from v.intent_id
   or existing.approved_at is distinct from p_approved_at or not exists(
    select 1 from cithela_private.cithela_mp_pilot_payment_proofs p where p.payment_id=p_payment_id
    and p.invoice_id=p_invoice_id and p.intent_id=v.intent_id and p.observed_live_mode=true and p.signed_event_received=true)
  then return jsonb_build_object('ok',false,'code','payment_identity_conflict'); end if;
 else
  insert into cithela_private.cithela_mp_pilot_payment_proofs(payment_id,invoice_id,intent_id,observed_live_mode,signed_event_received)
  values(p_payment_id,p_invoice_id,v.intent_id,true,true);
 end if;
 update cithela_private.cithela_mp_webhook_inbox set processing_status='reconciled' where id=e.id;
 -- No activation or entitlement mutation. This is internal test evidence only.
 return jsonb_build_object('ok',true,'code',case when inserted is null then 'already_reconciled' else 'test_payment_reconciled' end,'entitlement_activated',false);
end $fn$;
revoke all on function public.cithela_mp_reconcile_dentrix_test(text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.cithela_mp_reconcile_dentrix_test(text,text,text,timestamptz,uuid) to service_role;
