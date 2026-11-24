import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const groupApi=require('./block-groups.js');
const ranges=require('./ranges.js');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('let availabilityBlockGroupBusy=false;');
const end=html.indexOf('async function removeAvailabilityBlock(id)',begin);
assert.ok(begin>=0&&end>begin,'Group removal source must be present');
const code=html.slice(begin,end);
const DAY=86400000;
function makeBlocks(){
  const base=Date.parse('2026-11-27T03:00:00Z');
  let at=base;
  return [6,6,6,6,6,6,4].map((days,i)=>{
    const b={id:'demo-'+i,starts_at:new Date(at).toISOString(),
      ends_at:new Date(at+days*DAY).toISOString(),resource_id:null,reason:'Vacaciones',
      created_at:new Date(Date.parse('2026-11-23T19:45:00Z')+i*1000).toISOString()};
    at+=days*DAY;
    return b;
  });
}
function setup({confirm=true,permission=true,failIndex=-1}={}){
  let current=makeBlocks(),callCount=0;
  const dialogs=[],notifications=[],messages=[],buttons=[{disabled:false}];
  const scope={
    CithelaCloud:{
      state:()=>({tenant:{id:'tenant-demo',timezone:'America/Argentina/Buenos_Aires'},availabilityBlocks:current}),
      blockCommand:async command=>{
        if(failIndex>=0&&callCount===failIndex)throw Error('simulated_rpc_error');
        callCount++;
        assert.equal(command.tenantId,'tenant-demo');
        assert.equal(command.command,'availability_block.delete');
        assert.equal(typeof command.payload.id,'string');
        current=current.filter(x=>x.id!==command.payload.id);
      }
    },
    CithelaBlockRanges:ranges,
    window:{CithelaBlockGroups:groupApi},
    canManageCloudBlocks:()=>permission,
    cloudLocalParts:iso=>({fecha:new Date(iso).toISOString().slice(0,10),hora:'00:00'}),
    availabilityDisplayCivilDate:d=>d.slice(8)+'/'+d.slice(5,7)+'/'+d.slice(0,4),
    confirm:msg=>(dialogs.push(msg),confirm),
    cloudRequestId:p=>p+'-'+callCount,
    document:{querySelectorAll:()=>buttons},
    renderAvailabilityBlocks:()=>{},
    availabilityRangeFeedback:(msg,error)=>messages.push({msg,error}),
    toast:msg=>notifications.push(msg)
  };
  vm.createContext(scope);
  vm.runInContext(code,scope);
  return {scope,dialogs,messages,notifications,buttons,calls:()=>callCount,blocks:()=>current};
}
test('owner sees a single explicit confirmation and removes exactly seven chunks',async()=>{
  const a=setup();
  await a.scope.removeAvailabilityBlockGroup('demo-0');
  assert.equal(a.dialogs.length,1);
  assert.match(a.dialogs[0],/Se eliminarán 7 tramos/);
  assert.match(a.dialogs[0],/Los turnos existentes no cambiarán/);
  assert.equal(a.calls(),7);
  assert.equal(a.blocks().length,0);
  assert.equal(a.buttons[0].disabled,false);
  assert.match(a.messages.at(-1).msg,/Período eliminado/);
});
test('cancellation and lack of permissions cause zero deletions',async()=>{
  const no=setup({confirm:false});
  await no.scope.removeAvailabilityBlockGroup('demo-0');
  assert.equal(no.calls(),0);
  assert.equal(no.blocks().length,7);
  const denied=setup({permission:false});
  await denied.scope.removeAvailabilityBlockGroup('demo-0');
  assert.equal(denied.calls(),0);
  assert.equal(denied.dialogs.length,0);
});
test('partial failure never claims rollback; remaining blocks stay blocked',async()=>{
  const a=setup({failIndex:3});
  await a.scope.removeAvailabilityBlockGroup('demo-0');
  assert.equal(a.calls(),3);
  assert.equal(a.blocks().length,4);
  assert.match(a.messages.at(-1).msg,/Se quitaron 3 de 7/);
  assert.match(a.messages.at(-1).msg,/Los restantes siguen bloqueados/);
  assert.equal(a.buttons[0].disabled,false);
});
test('an unrelated ID never initiates a delete',async()=>{
  const a=setup();
  await a.scope.removeAvailabilityBlockGroup('not-a-group');
  assert.equal(a.calls(),0);
  assert.equal(a.dialogs.length,0);
});
