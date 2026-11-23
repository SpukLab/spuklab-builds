import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ranges from './ranges.js';

const {planRange,daysBetween,addDays,spansOverlap}=ranges;
test('1, 6, 7, 28, and 90 inclusive days use at most six civil days per chunk',()=>{
  for(const days of [1,6,7,28,60,90]){
    const from='2026-12-01',end=addDays(from,days-1);
    const plan=planRange(from,end);
    assert.equal(plan.days,days);
    assert.equal(plan.chunks.reduce((sum,c)=>sum+c.days,0),days);
    assert.ok(plan.chunks.every(c=>c.days>=1&&c.days<=6));
    assert.equal(plan.chunks[0].startDate,from);
    assert.equal(plan.chunks.at(-1).lastDate,end);
    for(let i=1;i<plan.chunks.length;i++){
      assert.equal(plan.chunks[i].startDate,plan.chunks[i-1].endExclusive);
    }
    for(const c of plan.chunks){
      assert.equal(daysBetween(c.startDate,c.endExclusive),c.days);
      assert.equal(addDays(c.lastDate,1),c.endExclusive);
    }
  }
});

test('year boundary and leap-year dates are correct',()=>{
  const p=planRange('2026-12-24','2027-01-04');
  assert.equal(p.days,12);
  assert.equal(p.chunks.length,2);
  assert.equal(p.chunks[1].endExclusive,'2027-01-05');
  assert.equal(daysBetween('2028-02-28','2028-03-01'),2);
  assert.equal(addDays('2028-02-28',1),'2028-02-29');
});

test('reject invalid, reversed, overly long, or malformed ranges',()=>{
  assert.throws(()=>planRange('2026-12-30','2026-12-24'),/invalid_order/);
  assert.throws(()=>planRange('2026-12-01','2027-03-01'),/range_too_long/);
  assert.throws(()=>planRange('2027-02-29','2027-03-01'),/invalid_date/);
  assert.throws(()=>planRange('2026-13-01','2026-12-04'),/invalid_date/);
  assert.throws(()=>planRange('12/24/2026','2026-12-26'),/invalid_date/);
  assert.throws(()=>planRange('2026-12-01','2026-12-06',{chunkDays:7}),/invalid_chunk/);
});

test('six civil days around US daylight saving time remain below 7x24 hours',()=>{
  // Actual America/Denver UTC midnights. October-November clock goes back.
  const fall=Date.parse('2026-11-04T07:00:00Z')-Date.parse('2026-10-29T06:00:00Z');
  const spring=Date.parse('2027-03-13T06:00:00Z')-Date.parse('2027-03-07T07:00:00Z');
  assert.equal(fall/3600000,145);
  assert.equal(spring/3600000,143);
  assert.ok(fall<7*86400000);
  assert.ok(spring<7*86400000);
});

test('consecutive periods are not overlaps; intersecting intervals are',()=>{
  assert.equal(spansOverlap('2026-12-24T03:00:00Z','2026-12-30T03:00:00Z',
    '2026-12-30T03:00:00Z','2027-01-05T03:00:00Z'),false);
  assert.equal(spansOverlap('2026-12-24T03:00:00Z','2026-12-30T03:00:00Z',
    '2026-12-29T03:00:00Z','2027-01-05T03:00:00Z'),true);
  assert.throws(()=>spansOverlap('fake','2026-12-30T03:00:00Z','2026-12-29T03:00:00Z','2027-01-05T03:00:00Z'),/invalid_time/);
});

test('CITHELA UI adds inclusive range mode but preserves existing single-day controls',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['cfg-block-modo','cfg-block-single','cfg-block-fecha','cfg-block-hora',
    'cfg-block-range','cfg-block-desde','cfg-block-hasta','cfg-block-motivo',
    'cfg-block-range-help','cfg-block-range-status','cfg-block-save','cfg-block-list']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/onchange="syncAvailabilityBlockMode\(\)"/);
  assert.match(html,/if\(\$\('cfg-block-modo'\)\?\.value==='range'\)\{/);
  assert.match(html,/return await addAvailabilityBlockRange\(\)/);
  assert.match(html,/CithelaBlockRanges\.planRange\(from,through\)/);
  assert.match(html,/CithelaBlockRanges\.spansOverlap/);
  assert.match(html,/if\(!confirm\(warning\)\)return/);
  assert.match(html,/availabilityRangeBusy/);
  assert.match(html,/each tranche|tramo sin guardar|próximo tramo sin guardar/);
  assert.match(html,/no se cancelan|NO se cancelan/);
  assert.match(html,/ranges\.js\?v=20261123/);
  assert.match(html,/@media\(max-width:650px\)/);
  assert.match(html,/availability-date-grid\[hidden\]\{display:none\}/);
});

test('large inline application script compiles without syntax errors',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('<script>\n// CITHELA PRODUCT SHELL');
  assert.ok(start>0);
  const code=html.slice(start+'<script>'.length,html.indexOf('</script>',start));
  assert.ok(code.length>200000);
  assert.doesNotThrow(()=>new vm.Script(code,{filename:'cithela/index.html inline'}));
});

test('ranges module does not access server, files, auth or browser storage',()=>{
  const content=readFileSync(new URL('./ranges.js',import.meta.url),'utf8');
  assert.doesNotMatch(content,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|supabase|\.rpc\s*\(/i);
});
