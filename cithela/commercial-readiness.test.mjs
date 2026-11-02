import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const html=read('./index.html');
const sql=read('./sql-review/commercial-onboarding-gate.sql');

test('operational application remains gated until explicit commercial activation',()=>{
  assert.match(html,/const CITHELA_SECOND_TENANT_PILOT=new URLSearchParams\(location\.search\)\.get\('pilotTenant'\)==='1'/);
  assert.match(html,/if\(!CITHELA_SECOND_TENANT_PILOT\|\|CithelaCloud\.state\(\)\.signedIn\)return;/);
  assert.match(html,/async function professionalCreatePilotWorkspace\(/);
  assert.match(html,/CithelaCloud\.bootstrap\(name\)/);
  assert.match(html,/if\(!result\?\.ok\|\|!\['workspace_created','workspace_exists'\]\.includes\(result\.code\)\)/);
  assert.doesNotMatch(html,/localStorage\.setItem\(['"]commercial_entitlement|\bservice_role\b|sb_secret_/i);
});

test('professional sees readable responses when server denies onboarding',()=>{
  assert.match(html,/reason==='onboarding_not_authorized'/);
  assert.match(html,/Consultá por el acceso comercial con SpukLab/);
  assert.match(html,/reason==='email_unverified'/);
  assert.match(html,/Confirmá el correo electrónico de tu cuenta/);
  assert.match(html,/reason==='workspace_not_visible'/);
});

test('candidate gate is not a public client decision or an unverified grant',()=>{
  assert.match(sql,/REVIEW-ONLY proposal, NOT DEPLOYED/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS cithela_private\.cithela_onboarding_grants/);
  assert.match(sql,/REVOKE ALL ON cithela_private\.cithela_onboarding_grants FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(sql,/actor uuid := auth\.uid\(\)/);
  assert.match(sql,/WHERE u\.id=actor FOR UPDATE/);
  assert.match(sql,/u\.email_confirmed_at IS NOT NULL/);
  assert.match(sql,/g\.user_id=actor AND g\.expires_at>now\(\)/);
  assert.match(sql,/g\.consumed_at IS NULL/);
  assert.match(sql,/code','onboarding_not_authorized/);
  assert.match(sql,/code','email_unverified/);
  assert.match(sql,/code','workspace_exists/);
  assert.match(sql,/SET consumed_at=now\(\)/);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE)\s+ON\s+cithela_private\.cithela_onboarding_grants\s+TO\s+(?:PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(sql,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cithela_bootstrap_tenant/i);
});

test('review-only SQL leaves appointments, patients and existing tenants untouched',()=>{
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM public\.cithela_|TRUNCATE|UPDATE public\.cithela_(?:people|appointments|tenants)/i);
  assert.match(sql,/IF existing_tenant IS NOT NULL THEN/);
  assert.match(sql,/existing_tenant,existing_name/);
  const prior=sql.indexOf('IF existing_tenant IS NOT NULL THEN');
  const gate=sql.indexOf("code','onboarding_not_authorized");
  assert.ok(prior>0&&gate>prior,'existing workspace takes priority over new-account gate');
});
