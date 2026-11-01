import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
// Disposable in-memory PostgreSQL. Minimal operational tables/bootstrap are fixtures;
// no network, no auth users or patient data from production.
const db=new PGlite();
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const U='00000000-0000-4000-8000-000000000003';
const P='00000000-0000-4000-8000-000000000004';
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema cithela_private;
grant usage on schema public,auth,cithela_private to authenticated,anon;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.cithela_tenants(id uuid primary key default gen_random_uuid(),display_name text);
create table public.cithela_tenant_memberships(tenant_id uuid,user_id uuid,role text);
create table public.cithela_patient_links(user_id uuid);
create function cithela_private.bootstrap_tenant(p_name text,p_tz text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; begin
 if length(trim(coalesce(p_name,''))) not between 1 and 160 then return jsonb_build_object('ok',false,'code','invalid_name'); end if;
 insert into public.cithela_tenants(display_name) values(p_name) returning id into t;
 insert into public.cithela_tenant_memberships values(t,auth.uid(),'owner');
 return jsonb_build_object('ok',true,'code','workspace_created','tenant',jsonb_build_object('id',t));
end $$;
insert into auth.users values('${A}',now()),('${B}',now()),('${U}',null),('${P}',now());
insert into public.cithela_patient_links values('${P}');
`);
await db.exec(readFileSync(new URL('./selfservice-draft.sql',import.meta.url),'utf8'));
async function rpc(user,fn,args=[]) {
 await db.exec('begin');
 try {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  await db.exec('set local role authenticated');
  const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
  const result=await db.query(`select public.${fn}(${placeholders}) as result`,args);
  await db.exec('rollback');return result.rows[0].result;
 }catch(e){await db.exec('rollback');throw e;}
}
// Mutating start RPC must commit in the fixture; production is never connected.
async function start(user,args=['Espacio','terms-v1','privacy-v1']){
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  await db.exec('set local role authenticated');
  const q=await db.query('select public.cithela_commercial_start($1,$2,$3) result',args);
  await db.exec('commit');return q.rows[0].result;
 }catch(e){await db.exec('rollback');throw e;}
}
test('trial SQL: disabled gate, verified owner, consent, isolation, expiry and immutable retries',async()=>{
 assert.equal((await start(null)).code,'unauthenticated');
 assert.equal((await start(U)).code,'verification_required');
 assert.equal((await start(A)).code,'signup_disabled');
 await db.exec("update cithela_private.commercial_release set signup_enabled=true");
 assert.equal((await start(A,['Espacio','DRAFT-NOT-ACCEPTABLE','DRAFT-NOT-ACCEPTABLE'])).code,'consent_required');
 await db.exec("update cithela_private.commercial_release set terms_version='terms-v1',privacy_version='privacy-v1'");
 assert.equal((await start(A,['Espacio','wrong','privacy-v1'])).code,'consent_required');
 assert.equal((await start(P)).code,'existing_account');
 const first=await start(A);assert.equal(first.code,'trial_started');
 const again=await start(A);assert.equal(again.code,'account_exists');assert.equal(again.tenant_id,first.tenant_id);assert.equal(again.trial_ends_at,first.trial_ends_at);
 const duration=await db.query("select extract(epoch from trial_ends_at-trial_started_at) seconds from cithela_private.commercial_accounts");assert.equal(Number(duration.rows[0].seconds),604800);
 assert.equal((await rpc(B,'cithela_commercial_status')).code,'not_enrolled');
 assert.equal((await rpc(A,'cithela_commercial_status')).can_accept_bookings,true);
 // Force simulated clock boundary by shifting both immutable endpoints in fixture admin context.
 await db.exec("update cithela_private.commercial_accounts set trial_started_at=now()-interval '8 days',trial_ends_at=now()-interval '1 day'");
 assert.equal((await rpc(A,'cithela_commercial_status')).status,'trial_expired');
 assert.equal((await rpc(A,'cithela_commercial_status')).can_accept_bookings,false);
 await db.exec("update cithela_private.commercial_accounts set status='active',current_period_end=null");
 assert.equal((await rpc(A,'cithela_commercial_status')).status,'past_due');
 for(const status of ['canceled','suspended','payment_pending','past_due']){
  await db.query('update cithela_private.commercial_accounts set status=$1',[status]);
  assert.equal((await rpc(A,'cithela_commercial_status')).can_accept_bookings,false);
 }
 const counts=await db.query('select count(*) n from public.cithela_tenants');assert.equal(Number(counts.rows[0].n),1);
 await db.exec('begin; set local role authenticated');
 await assert.rejects(db.query('update cithela_private.commercial_accounts set status=\'active\''),/permission denied/);
 await db.exec('rollback; begin; set local role anon');
 await assert.rejects(db.query('select public.cithela_commercial_status()'),/permission denied/);
 await db.exec('rollback');
});
test.after(async()=>db.close());
