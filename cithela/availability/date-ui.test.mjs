import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ranges from './ranges.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('function availabilityDisplayCivilDate(');
const end=html.indexOf('function availabilityRangeFeedback(',begin);
assert.ok(begin>=0&&end>begin);
const source=html.slice(begin,end);

function demo({start='2026-11-23',finish='2026-01-15'}={}){
  const els={
    'cfg-block-modo':{value:'range'},
    'cfg-block-desde':{value:start,min:'2026-11-23'},
    'cfg-block-hasta':{value:finish,min:'2026-11-23'},
    'cfg-block-range-summary':{hidden:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}},
    'cfg-block-single':{hidden:false},
    'cfg-block-range':{hidden:true},
    'cfg-block-range-help':{hidden:true},
    'cfg-block-save':{textContent:''},
    'cfg-block-range-status':{textContent:''}
  };
  const ctx={
    $:k=>els[k],
    window:{CithelaBlockRanges:ranges},
    Date,Intl
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  return {els,ctx};
}
test('stale iPhone Hasta value in January 2026 is clamped to Desde November 2026 on load',()=>{
  const {els,ctx}=demo();
  ctx.syncAvailabilityBlockMode();
  assert.equal(els['cfg-block-hasta'].min,'2026-11-23');
  assert.equal(els['cfg-block-hasta'].value,'2026-11-23');
  assert.match(els['cfg-block-range-summary'].textContent,/23\/11\/2026/);
  assert.match(els['cfg-block-range-summary'].textContent,/1 día/);
  assert.equal(els['cfg-block-range-summary'].attrs['data-invalid'],'false');
  assert.equal(els['cfg-block-range'].hidden,false);
});
test('user choosing invalid end year sees explicit dates and error; the value is not silently changed',()=>{
  const {els,ctx}=demo({finish:'2026-11-23'});
  els['cfg-block-hasta'].value='2026-01-15';
  ctx.syncAvailabilityRangeDates('end');
  assert.match(els['cfg-block-range-summary'].textContent,/15\/01\/2026/);
  assert.match(els['cfg-block-range-summary'].textContent,/23\/11\/2026/);
  assert.match(els['cfg-block-range-summary'].textContent,/Revisá el año/);
  assert.equal(els['cfg-block-range-summary'].attrs['data-invalid'],'true');
  assert.equal(els['cfg-block-hasta'].value,'2026-01-15');
});
test('valid dates crossing New Year remain intact and show total civil days',()=>{
  const {els,ctx}=demo({start:'2026-12-24',finish:'2027-01-04'});
  ctx.syncAvailabilityRangeDates('end');
  assert.equal(els['cfg-block-hasta'].min,'2026-12-24');
  assert.equal(els['cfg-block-hasta'].value,'2027-01-04');
  assert.match(els['cfg-block-range-summary'].textContent,/24\/12\/2026/);
  assert.match(els['cfg-block-range-summary'].textContent,/04\/01\/2027/);
  assert.match(els['cfg-block-range-summary'].textContent,/12 días/);
  assert.equal(els['cfg-block-range-summary'].attrs['data-invalid'],'false');
});
test('changing Desde forward resets invalid Hasta; changing it backward preserves a valid end',()=>{
  const {els,ctx}=demo({start:'2026-12-24',finish:'2027-01-04'});
  els['cfg-block-desde'].value='2027-02-01';
  ctx.syncAvailabilityRangeDates('start');
  assert.equal(els['cfg-block-hasta'].min,'2027-02-01');
  assert.equal(els['cfg-block-hasta'].value,'2027-02-01');
  els['cfg-block-desde'].value='2026-12-24';
  ctx.syncAvailabilityRangeDates('start');
  assert.equal(els['cfg-block-hasta'].value,'2027-02-01');
});
test('longer than 90 days is signalled before saving',()=>{
  const {els,ctx}=demo({start:'2026-11-23',finish:'2027-04-01'});
  ctx.syncAvailabilityRangeDates('end');
  assert.match(els['cfg-block-range-summary'].textContent,/supera 90 días/);
  assert.equal(els['cfg-block-range-summary'].attrs['data-invalid'],'true');
});
test('controls are mobile-friendly and no longer contain a long native select label',()=>{
  assert.match(html,/id="cfg-block-range-summary"/);
  assert.match(html,/onchange="syncAvailabilityRangeDates\('start'\)"/);
  assert.match(html,/onchange="syncAvailabilityRangeDates\('end'\)"/);
  assert.match(html,/syncAvailabilityRangeDates\('refresh'\)/);
  assert.match(html,/id="cfg-block-modo"/);
  assert.match(html,/Varios días \(vacaciones\)/);
  assert.match(html,/\.availability-date-grid input\[type="date"\]/);
  assert.match(html,/font-size:16px/);
  assert.match(html,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/«Hasta»/);
  assert.match(html,/Revisá el año/);
});
