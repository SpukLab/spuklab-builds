import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('./supabase/commercial-status-owner-rpc-20261102.sql',import.meta.url),'utf8');

const start=app.indexOf('function renderCithelaCommercialPanel(s){');
const end=app.indexOf('function renderCithelaFirstSteps(s){',start);
const renderSource=app.slice(start,end);

function harness(){
  const els={
    'cithela-commercial-panel':{hidden:true},
    'cithela-commercial-status':{textContent:''},
    'cithela-commercial-detail':{textContent:''}
  };
  const render=new Function('$',renderSource+';return renderCithelaCommercialPanel;')(id=>els[id]);
  const base={tenant:{id:'my-tenant'},membership:{role:'owner'}};
  return {els,base,render};
}

test('status panel is available only for a signed-in professional owner/admin',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(app,/id="cithela-commercial-panel"[^>]*hidden/);
  assert.match(app,/aria-labelledby="cithela-commercial-title"/);
  assert.match(app,/renderCithelaCommercialPanel\(active\?s:null\)/);
  const {els,base,render}=harness();
  render(null);
  assert.equal(els['cithela-commercial-panel'].hidden,true);
  render({...base,membership:{role:'operator'}});
  assert.equal(els['cithela-commercial-panel'].hidden,true);
  render({...base,membership:{role:'admin'},commercialStatus:{ok:true,status:'legacy'}});
  assert.equal(els['cithela-commercial-panel'].hidden,false);
});

test('legacy clients see service enabled, not a forced payment or trial',()=>{
  const {els,base,render}=harness();
  render({...base,commercialStatus:{ok:true,status:'legacy',can_book:true}});
  assert.match(els['cithela-commercial-status'].textContent,/Servicio habilitado/);
  assert.match(els['cithela-commercial-detail'].textContent,/No necesitás realizar/);
  assert.doesNotMatch(els['cithela-commercial-detail'].textContent,/comprar|pagar ahora/i);
});

test('trial countdown is sourced from server result, not local clock',()=>{
  const {els,base,render}=harness();
  render({...base,commercialStatus:{ok:true,status:'trialing',can_book:true,days_remaining:5}});
  assert.match(els['cithela-commercial-status'].textContent,/5 días restantes/);
  render({...base,commercialStatus:{ok:true,status:'trialing',days_remaining:1}});
  assert.match(els['cithela-commercial-status'].textContent,/1 día restante/);
  render({...base,commercialStatus:{ok:true,status:'trialing',days_remaining:0}});
  assert.match(els['cithela-commercial-status'].textContent,/Menos de un día/);
  assert.doesNotMatch(renderSource,/Date\.now|new Date|localStorage|sessionStorage/);
});

test('expired trial preserves historical access and cancellation in messaging',()=>{
  const {els,base,render}=harness();
  render({...base,commercialStatus:{ok:true,status:'trial_expired',can_book:false}});
  assert.match(els['cithela-commercial-status'].textContent,/finalizada/);
  assert.match(els['cithela-commercial-detail'].textContent,/cancelar reservas existentes/);
  render({...base,commercialStatus:{ok:false,code:'unavailable'}});
  assert.equal(els['cithela-commercial-status'].textContent,'Estado no disponible');
  assert.match(els['cithela-commercial-detail'].textContent,/Actualizá/);
});

test('status is loaded on the existing cloud refresh without blocking appointment data',()=>{
  assert.match(app,/c\.rpc\('cithela_commercial_status',\{p_tenant_id:tenantId\}\)/);
  assert.match(app,/commercialStatusQ=\['owner','admin'\]\.includes\(membership\.role\)/);
  assert.match(app,/\.catch\(\(\)=>\(\{ok:false,code:'unavailable'\}\)\)/);
  assert.match(app,/state\.commercialStatus=commercialStatusQResult/);
  assert.match(app,/commercialStatus:state\.commercialStatus\?\{\.\.\.state\.commercialStatus\}:null/);
  assert.match(app,/state\.commercialStatus=null;/);
  assert.doesNotMatch(app,/localStorage\.setItem\(['"]commercial|sb_secret_|service_role/i);
});

test('read-only status RPC is restricted by authenticated owner/admin membership',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.cithela_commercial_status\(p_tenant_id uuid\)/);
  assert.match(sql,/actor uuid := auth\.uid\(\)/);
  assert.match(sql,/IF actor IS NULL THEN/);
  assert.match(sql,/m\.user_id=actor AND m\.tenant_id=p_tenant_id/);
  assert.match(sql,/m\.role IN \('owner','admin'\)/);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/SET search_path TO ''/);
  assert.match(sql,/cithela_private\.commercial_entitlement_snapshot/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_commercial_status\(uuid\)\s+FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.cithela_commercial_status\(uuid\)\s+TO authenticated/);
  assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|current_setting\('request\.jwt\.claim\.role'\)|raw_user_meta_data|provider_subscription_id/i);
});

test('RPC returns only safe status fields, no payment IDs or PII',()=>{
  assert.match(sql,/'server_checked_at',statement_timestamp\(\)/);
  assert.match(sql,/'days_remaining',left_days/);
  assert.match(sql,/'can_book',coalesce/);
  assert.doesNotMatch(sql,/email|phone|payment_method|subscription_id|service_role|api_key|payment_alias/i);
});
