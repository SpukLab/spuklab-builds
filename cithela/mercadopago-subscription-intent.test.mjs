import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('./supabase/mercadopago-subscription-intent-link-20261103.sql',import.meta.url),'utf8');

test('all commercial intent data are private, row secured and unavailable from browsers',()=>{
  assert.match(sql,/CREATE TABLE cithela_private\.cithela_mp_subscription_intents/);
  assert.match(sql,/ALTER TABLE cithela_private\.cithela_mp_subscription_intents ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON cithela_private\.cithela_mp_subscription_intents\s+FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_mp_classify_inbox_event\(bigint\)\s+FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.cithela_mp_classify_inbox_event\(bigint\)\s+TO service_role/);
  assert.doesNotMatch(sql,/GRANT\s+(?:INSERT|UPDATE|DELETE|SELECT)\s+ON\s+cithela_private\.cithela_mp_subscription_intents\s+TO\s+(?:anon|authenticated)/i);
});

test('order references, provider subscription and tenant ownership are unique',()=>{
  assert.match(sql,/external_reference text NOT NULL UNIQUE/);
  assert.match(sql,/provider_subscription_id text UNIQUE/);
  assert.match(sql,/CREATE UNIQUE INDEX cithela_mp_one_open_intent_per_tenant/);
  assert.match(sql,/ON cithela_private\.cithela_mp_subscription_intents \(tenant_id\)\s+WHERE stage<>'canceled'/);
  assert.match(sql,/tenant_id uuid NOT NULL REFERENCES public\.cithela_tenants\(id\)/);
  assert.match(sql,/owner_user_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
});

test('consent, owner role, entitlement and environment are validated before an intent',()=>{
  assert.match(sql,/opted_in_at timestamptz NOT NULL/);
  assert.match(sql,/NEW\.opted_in_at<statement_timestamp\(\)-interval '15 minutes'/);
  assert.match(sql,/m\.tenant_id=NEW\.tenant_id AND m\.user_id=NEW\.owner_user_id/);
  assert.match(sql,/m\.role='owner' AND e\.owner_user_id=NEW\.owner_user_id/);
  assert.match(sql,/e\.status IN \('trialing','payment_pending','past_due'\)/);
  assert.match(sql,/live_mode boolean NOT NULL DEFAULT false CHECK \(live_mode=false\)/);
  assert.match(sql,/currency_id text NOT NULL DEFAULT 'ARS' CHECK \(currency_id='ARS'\)/);
  assert.match(sql,/amount_minor bigint NOT NULL CHECK \(amount_minor BETWEEN/);
});

test('binding is immutable and cancellation cannot accidentally relink another tenant',()=>{
  assert.match(sql,/immutable_commercial_intent/);
  assert.match(sql,/provider_id_already_bound/);
  assert.match(sql,/invalid_commercial_stage_transition/);
  assert.match(sql,/OLD\.stage='prepared' AND NEW\.stage='linked'/);
  assert.match(sql,/OLD\.stage='linked' AND NEW\.stage='cancel_requested'/);
  assert.match(sql,/OLD\.stage='cancel_requested' AND NEW\.stage='canceled'/);
  assert.match(sql,/stage='linked' AND provider_subscription_id IS NOT NULL/);
});

test('a signed notification is never payment confirmation and simulations are ignored',()=>{
  assert.match(sql,/left\(ev\.event_id,4\)='sim_'/);
  assert.match(sql,/'simulated_ignore'/);
  assert.match(sql,/'payment_requires_provider_lookup'/);
  assert.match(sql,/'unmatched_requires_review'/);
  assert.match(sql,/'matched_unverified'/);
  assert.match(sql,/'requires_provider_fetch',true/);
  assert.match(sql,/i\.provider_subscription_id=ev\.resource_id/);
  assert.match(sql,/i\.collector_id=ev\.merchant_user_id/);
  assert.match(sql,/i\.live_mode=ev\.live_mode/);
  assert.doesNotMatch(sql,/UPDATE\s+cithela_private\.cithela_commercial_entitlements|INSERT\s+INTO\s+cithela_private\.cithela_commercial_entitlements/i);
  assert.doesNotMatch(sql,/api\.mercadopago|access_token|checkout_url|payer_email/);
});
