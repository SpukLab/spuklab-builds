import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
for(const filename of ['reservar.html','compartir.html']){
  test(filename+' parses scripts and contains no duplicate IDs',()=>{
    const html=read(filename);
    const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m=>m[1]).filter(js=>js.trim());
    assert.ok(scripts.length>0,'Expected inline JS');
    for(const js of scripts)assert.doesNotThrow(()=>new Function(js));
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
  });
}
test('booking public flow is opt-in and email verified',()=>{
  const sql=read('sql/20261115_public_booking_pilot.sql');
  const html=read('reservar.html');
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/u\.email_confirmed_at is not null/);
  assert.match(html,/CithelaAuthCaptcha\?\.wrap\(client\)/);
  assert.match(html,/cithela_public_booking_attach/);
  assert.match(html,/cithela_patient_booking_create/);
  assert.match(html,/getUser\(\)/);
  assert.doesNotMatch(html,/window\.service_role/);
});
test('professional sharing retains explicit enable switch',()=>{
  const html=read('compartir.html');
  assert.match(html,/id="enabled" type="checkbox"/);
  assert.match(html,/cithela_public_booking_config/);
  assert.match(html,/cithela_public_booking_timezone_update/);
});
