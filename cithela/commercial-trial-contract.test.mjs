import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('./sql-review/commercial-trial-entitlements-v0.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('trial design is review-only, not an accidental live migration or signup',()=>{
  assert.match(sql,/REVIEW ONLY, NOT DEPLOYED/);
  assert.match(sql,/cithela_private.cithela_commercial_entitlements/);
  assert.doesNotMatch(app,/startCommercialTrial|commercial_entitlement_snapshot|commercial_checkout/);
  assert.match(app,/CITHELA_SECOND_TENANT_PILOT=new URLSearchParams/);
});
test('entitlements are private and deny direct client mutations',()=>{
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON cithela_private.cithela_commercial_entitlements FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/SET search_path TO ''/);
  assert.match(sql,/REVOKE ALL ON FUNCTION cithela_private.commercial_entitlement_snapshot\(uuid,timestamptz\)/);
  assert.doesNotMatch(sql,/GRANT (?:ALL|SELECT|INSERT|UPDATE|EXECUTE)[\s\S]*?TO (?:anon|authenticated)/i);
});
test('exact seven-day trial and server-time expiry with no implicit payments',()=>{
  assert.match(sql,/trial_ends_at=trial_started_at\+interval '7 days'/);
  assert.match(sql,/p_check_at timestamptz DEFAULT statement_timestamp\(\)/);
  assert.match(sql,/IF p_check_at<e.trial_ends_at THEN allowed:=true/);
  assert.match(sql,/ELSE s:='trial_expired'/);
  assert.match(sql,/current_period_end>p_check_at/);
  assert.match(sql,/RETURN jsonb_build_object\([\s\S]*'can_book',allowed/);
  assert.match(sql,/status IN \('legacy','trialing','payment_pending','active','past_due','canceled','suspended'\)/);
  assert.doesNotMatch(sql,/create_checkout|payment_link|mercadopago|UPDATE public.cithela_appointments/i);
});
test('current professional establishments must be grandfathered before enforcement',()=>{
  assert.match(sql,/INSERT INTO cithela_private.cithela_commercial_entitlements/);
  assert.match(sql,/SELECT m.tenant_id,m.user_id,'legacy'/);
  assert.match(sql,/ON CONFLICT \(tenant_id\) DO NOTHING/);
  assert.match(sql,/WHERE m.role='owner'/);
  assert.match(sql,/WHERE trial_started_at IS NOT NULL AND owner_user_id IS NOT NULL/);
  assert.match(sql,/status','not_configured','can_book',false/);
});
