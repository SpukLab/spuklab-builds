import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('./sql-review/commercial-booking-enforcement-v1.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const routine=name=>{
 const begin=sql.indexOf('CREATE OR REPLACE FUNCTION cithela_private.'+name+'(');
 assert.ok(begin>=0,name+' missing');
 const next=sql.indexOf('\n-- Patched source function:',begin+1);
 return sql.slice(begin,next>=0?next:sql.length);
};

test('complete server-side booking surface is covered, not just frontend flags',()=>{
 for(const name of [
   'reservation_command','patient_booking_create','patient_appointment_command',
   'patient_reschedule_slots','channel_command','channel_availability_core'
 ]) {
   assert.match(routine(name),/commercial_entitlement_snapshot/);
   assert.match(routine(name),/subscription_required/);
 }
 assert.match(sql,/CREATE TRIGGER cithela_appointment_commercial_guard/);
 assert.match(sql,/BEFORE INSERT OR UPDATE ON public.cithela_appointments/);
 assert.match(sql,/NEW\.starts_at IS DISTINCT FROM OLD\.starts_at/);
 assert.match(sql,/NEW\.ends_at IS DISTINCT FROM OLD\.ends_at/);
 assert.match(sql,/OLD\.status NOT IN \('pending','confirmed'\)/);
 assert.match(sql,/NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id/);
 assert.match(sql,/RAISE EXCEPTION 'cithela_subscription_required'/);
});

test('cancellation, attendance and confirmation without slot change remain possible',()=>{
 const g=routine('appointment_commercial_guard');
 assert.match(g,/requires_access := NEW\.status IN \('pending','confirmed'\) AND/);
 assert.doesNotMatch(g,/new\.status='cancelled' THEN RAISE/i);
 assert.match(g,/NEW\.starts_at IS DISTINCT FROM OLD\.starts_at/);
 assert.match(g,/RETURN NEW/);
});

test('trial starts atomically with authorized bootstrap and keeps old clients',()=>{
 const b=routine('bootstrap_tenant');
 assert.match(b,/IF existing_tenant IS NOT NULL THEN/);
 assert.match(b,/code','workspace_exists/);
 assert.match(b,/cithela_onboarding_grants g/);
 assert.match(b,/g\.user_id=actor AND g\.consumed_at IS NULL/);
 assert.match(b,/g\.terms_version/);
 assert.match(b,/statement_timestamp\(\), statement_timestamp\(\)\+interval '7 days'/);
 assert.match(b,/INSERT INTO cithela_private.cithela_commercial_entitlements/);
 assert.match(sql,/SELECT m\.tenant_id,m\.user_id,'legacy'/);
 assert.match(sql,/ON CONFLICT \(tenant_id\) DO NOTHING/);
});

test('entitlement and server functions are private',()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON cithela_private.cithela_commercial_entitlements FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION cithela_private.commercial_entitlement_snapshot/);
 assert.match(sql,/REVOKE ALL ON FUNCTION cithela_private.appointment_commercial_guard/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|SELECT|INSERT|UPDATE|EXECUTE) [^;]* TO (?:anon|authenticated)/i);
 assert.match(sql,/trial_ends_at=trial_started_at\+interval '7 days'/);
 assert.match(sql,/IF p_check_at<e\.trial_ends_at THEN allowed:=true/);
 assert.match(sql,/ELSE s:='trial_expired'/);
 assert.match(sql,/status','not_configured','can_book',false/);
});

test('booking gating cannot be turned on from browser or success redirect',()=>{
 assert.doesNotMatch(app,/localStorage\.setItem\(['"]commercial_entitlement|service_role|sb_secret_/i);
 assert.match(app,/CITHELA_SECOND_TENANT_PILOT=new URLSearchParams/);
 assert.doesNotMatch(sql,/mercadopago|checkout_url|webhook_paid|UPDATE public\.cithela_appointments SET status='paid'/i);
});

test('staging SQL remains review-only until verified deployment',()=>{
 assert.match(sql,/REVIEW \/ DO NOT DEPLOY until full transaction tests pass/);
 assert.ok(sql.length>30000,'all existing routines must be preserved verbatim');
});
