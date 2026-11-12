import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('function renderCithelaFirstSteps(s){');
const end=html.indexOf('function renderReportSource(){',start);
const code=html.slice(start,end);

function harness(cloud=true){
  const refs={
    'cithela-first-steps':{hidden:true},
    'first-step-hours-state':{textContent:''},
    'first-step-services-state':{textContent:''},
    'first-step-people-state':{textContent:''},
    'cfg-section-hours':{tagName:'DETAILS',open:false,scrollIntoView(){this.scrolled=true;}},
    'cfg-section-services':{tagName:'DETAILS',open:false,scrollIntoView(){this.scrolled=true;}},
    'person-create-details':{tagName:'DETAILS',open:false,scrollIntoView(){this.scrolled=true;}},
    'medico-tab-personas':{id:'medico-tab-personas'},
    'medico-tab-config':{id:'medico-tab-config'}
  };
  const tabs=[];
  const methods=new Function('$','professionalCloudReady','tab',code+';return {renderCithelaFirstSteps,openCithelaFirstSteps};')(
    id=>refs[id],()=>cloud,(role,screen,button)=>tabs.push({role,screen,button:button?.id})
  );
  return {...methods,refs,tabs};
}

test('first-run card is present, hidden by default, and has actionable accessible controls',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(html, /id="cithela-first-steps"[^>]*hidden/);
  assert.match(html, /aria-labelledby="cithela-first-steps-title"/);
  assert.match(html, /\.cithela-first-steps\[hidden\]\{display:none!important;/);
  for (const section of ['hours','services','people']) {
    assert.match(html,new RegExp('onclick="openCithelaFirstSteps\\(\\x27'+section+'\\x27\\)"'));
  }
});

test('new professional sees existing cloud configuration steps, without false completion',()=>{
  const app=harness();
  app.renderCithelaFirstSteps({
    tenant:{id:'a'},membership:{role:'owner'},appointmentCount:0,
    workingHoursCount:0,serviceCount:1,peopleCount:0
  });
  assert.equal(app.refs['cithela-first-steps'].hidden,false);
  assert.match(app.refs['first-step-hours-state'].textContent,/Definí/);
  assert.match(app.refs['first-step-services-state'].textContent,/Revisá/);
  assert.match(app.refs['first-step-people-state'].textContent,/Cargá nombre y WhatsApp/);
  app.renderCithelaFirstSteps({
    tenant:{id:'a'},membership:{role:'owner'},appointmentCount:0,
    workingHoursCount:6,serviceCount:1,peopleCount:1
  });
  assert.match(app.refs['first-step-hours-state'].textContent,/guardados/);
  assert.match(app.refs['first-step-people-state'].textContent,/Ficha creada/);
});

test('existing client and local access never show onboarding again',()=>{
  const app=harness();
  app.renderCithelaFirstSteps({tenant:{id:'a'},membership:{role:'owner'},appointmentCount:1});
  assert.equal(app.refs['cithela-first-steps'].hidden,true);
  app.renderCithelaFirstSteps(null);
  assert.equal(app.refs['cithela-first-steps'].hidden,true);
});

test('all three shortcuts navigate to existing sections and open their details',()=>{
  const app=harness();
  for (const [target,id,pane] of [
    ['hours','cfg-section-hours','config'],
    ['services','cfg-section-services','config'],
    ['people','person-create-details','pacientes']
  ]) {
    app.openCithelaFirstSteps(target);
    assert.equal(app.refs[id].open,true,id);
    assert.equal(app.refs[id].scrolled,true,id);
    assert.equal(app.tabs.at(-1).screen,pane,id);
  }
  const before=app.tabs.length;
  app.openCithelaFirstSteps('arbitrary');
  assert.equal(app.tabs.length,before);
  assert.equal(harness(false).openCithelaFirstSteps('hours'),undefined);
});

test('commercial checklist cannot create tenants, pay or change RLS',()=>{
  assert.doesNotMatch(code,/\.rpc\(|\.insert\(|\.update\(|fetch\(|localStorage|pilotTenant|service_role/);
  assert.match(html,/renderCithelaFirstSteps\(active\?s:null\)/);
  assert.match(html,/CITHELA_SECOND_TENANT_PILOT=new URLSearchParams/);
});
