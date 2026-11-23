import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ranges from './ranges.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function take(start,end){
  const s=html.indexOf(start), e=html.indexOf(end,s+start.length);
  assert.ok(s>=0&&e>s,'source function markers '+start+'/'+end);
  return html.slice(s,e);
}
const localPartsSource=take('function cloudLocalParts(', 'function cloudAppointmentViews()');
const zonedSource=take('function zonedLocalToIso(', 'async function cloudProbeAvailability()');
const rangeSource=take('let availabilityRangeBusy=false;', 'async function addAvailabilityBlock(){');
const code=[localPartsSource,zonedSource,rangeSource].join('\n');

function setup({from='2026-12-24',through='2027-01-04',
    existing=[],appointments=[],failAfter=-1,role='owner'}={}){
  const elements={
    'cfg-block-desde':{value:from},'cfg-block-hasta':{value:through},
    'cfg-block-motivo':{value:'Vacaciones'},
    'cfg-block-range-status':{textContent:''},
    'cfg-block-save':{disabled:false}
  };
  const records=[];
  const state={
    tenant:{id:'tenant-example',timezone:'America/Argentina/Buenos_Aires'},
    membership:{role},availabilityBlocks:existing,
  };
  let refreshed=0;
  const scope={
    $:id=>elements[id]??{value:'',textContent:''},
    CithelaBlockRanges:ranges,
    CithelaCloud:{
      state:()=>state,
      blockCommand:async input=>{
        if(failAfter>=0&&records.length>=failAfter)throw Error('simulated_network_failure');
        records.push(input);
        state.availabilityBlocks.push({
          id:'block-'+records.length,resource_id:null,...input.payload
        });
      }
    },
    Date,Intl,
    professionalCloudReady:()=>true,
    cloudAppointmentViews:()=>appointments,
    canManageCloudBlocks:()=>role==='owner'||role==='admin',
    today:()=> '2026-11-23',
    DB:{t:()=>[]},
    confirm:()=>true,
    cloudRequestId:prefix=>prefix+'-'+(records.length+1),
    renderAvailabilityBlocks:()=>{refreshed++},
    toast:()=>{}
  };
  vm.createContext(scope);
  vm.runInContext(code,scope,{filename:'CITHELA Cloud range'});
  return {scope,elements,records,state,renderCount:()=>refreshed};
}

test('real cloud handler submits all vacation chunks, not merely local demo',async()=>{
  const h=setup();
  await h.scope.addAvailabilityBlockRange();
  assert.equal(h.records.length,2,JSON.stringify(h.elements['cfg-block-range-status']));
  assert.deepEqual(h.records.map(x=>x.command),['availability_block.create','availability_block.create']);
  assert.equal(h.records[0].payload.starts_at,'2026-12-24T03:00:00.000Z');
  assert.equal(h.records[0].payload.ends_at,'2026-12-30T03:00:00.000Z');
  assert.equal(h.records[1].payload.starts_at,'2026-12-30T03:00:00.000Z');
  assert.equal(h.records[1].payload.ends_at,'2027-01-05T03:00:00.000Z');
  assert.match(h.elements['cfg-block-range-status'].textContent,/12 días/);
  assert.equal(h.elements['cfg-block-save'].disabled,false);
  assert.equal(h.renderCount(),1);
});

test('existing overlapping block prevents remote submission',async()=>{
  const existing=[{
    starts_at:'2026-12-26T03:00:00Z',
    ends_at:'2026-12-28T03:00:00Z',resource_id:null
  }];
  const h=setup({existing});
  await h.scope.addAvailabilityBlockRange();
  assert.equal(h.records.length,0);
  assert.match(h.elements['cfg-block-range-status'].textContent,/bloqueo/i);
});

test('partial RPC failure keeps successful spans and tells user where to resume',async()=>{
  const h=setup({failAfter:1});
  await h.scope.addAvailabilityBlockRange();
  assert.equal(h.records.length,1);
  assert.equal(h.elements['cfg-block-desde'].value,'2026-12-30');
  assert.match(h.elements['cfg-block-range-status'].textContent,/1 de 2/);
  assert.equal(h.elements['cfg-block-save'].disabled,false);
});

test('an unprivileged operator is refused before any RPC',async()=>{
  const h=setup({role:'operator'});
  await h.scope.addAvailabilityBlockRange();
  assert.equal(h.records.length,0);
  assert.match(h.elements['cfg-block-range-status'].textContent,/permiso/i);
});
