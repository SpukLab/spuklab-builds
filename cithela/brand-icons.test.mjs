import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL(p,import.meta.url));
const manifest=JSON.parse(read('./brand/approved-assets.json'));
test('commercial and admin images retain the two approved originals without redrawing',()=>{
 for(const name of ['cithela','admin']){
  assert.equal(createHash('sha256').update(read('./brand/'+manifest[name].source)).digest('hex'),manifest[name].sha256);
  const svg=read('./brand/'+name+'-favicon.svg').toString();
  assert.ok(svg.includes('data:image/png;base64,'+read('./brand/'+name+'-icon-512.png').toString('base64')));
  assert.doesNotMatch(svg,/<path|<script/);
 }
 assert.notDeepEqual(read('./brand/admin-icon-512.png'),read('./brand/cithela-icon-512.png'));
});
test('professional and administrative shortcuts use their own versioned image and manifest',()=>{
 for(const file of ['index.html','alta-profesional.html','alta-whatsapp.html','comercial-admin.html','invitar-profesionales.html']){
  const name=['comercial-admin.html','invitar-profesionales.html'].includes(file)?'admin':'cithela';
  const page=read('./'+file).toString();
  for(const asset of [name+'-favicon.svg',name+'-touch-180.png',name+'.webmanifest'])assert.ok(page.includes(asset+'?v=20261110-final'));
 }
});
