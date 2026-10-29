import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const slice=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));

test('application JS parses, with no duplicate HTML ids',()=>{
 const m=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(m,'main script');
 assert.doesNotThrow(()=>new Function(m[1]));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,'HTML ids are unique');
});

test('professional navigation has five primary tasks; reports remain reachable',()=>{
 const nav=slice('<div id="screen-medico"','<div id="p-medico-agenda"').match(/<div class="tabs"[^>]*>([\s\S]*?)<\/div>/)?.[1];
 assert.ok(nav);
 assert.equal((nav.match(/<button /g)||[]).length,5);
 for(const id of ['agenda','personas','nuevo','config'])assert.ok(nav.includes('id="medico-tab-'+id+'"'));
 assert.ok(nav.includes('id="cloud-wa-tab"'));
 assert.doesNotMatch(nav,/>Reportes<\/button>/);
 assert.match(html,/id="p-medico-config"[\s\S]*?Reportes y exportaciones/);
 assert.match(html,/id="p-medico-reportes"[\s\S]*?Volver a Ajustes/);
});

test('appointments before weekly metrics; people search before collapsed add form',()=>{
 const agenda=slice('id="p-medico-agenda"','id="p-medico-pacientes"');
 assert.ok(agenda.indexOf('id="agenda-list"')<agenda.indexOf('id="stats"'));
 assert.match(agenda,/medico-tab-nuevo/);
 const people=slice('id="p-medico-pacientes"','id="p-medico-nuevo"');
 assert.ok(people.indexOf('id="s-pac"')<people.indexOf('id="person-create-details"'));
 assert.match(people,/<details class="cithela-config-group person-create" id="person-create-details">/);
 assert.doesNotMatch(people,/<details[^>]*person-create[^>]*open/);
});

test('configuration prioritizes daily use; nested details remain balanced',()=>{
 const cfg=slice('id="p-medico-config"','<div class="byline">');
 const order=[...cfg.matchAll(/id="cfg-section-([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(order,['hours','availability','services','resources','reminders','business','branding','payments','cloud','infrastructure','security']);
 let depth=0;
 for(const token of (cfg.match(/<\/?details\b[^>]*>/g)||[])){
   depth+=token.startsWith('</')?-1:1;
   assert.ok(depth>=0,'details cannot close before opening');
 }
 assert.equal(depth,0,'every details closes');
});

test('report shortcut follows operational configuration and infrastructure',()=>{
 const cfg=slice('id="p-medico-config"','<div class="byline">');
 const reportPos=cfg.indexOf('class="mb ghost settings-report-link"');
 assert.ok(reportPos>cfg.indexOf('id="cfg-section-hours"'),'horarios first');
 assert.ok(reportPos>cfg.indexOf('id="cfg-section-security"'),'reports are last');
 assert.match(cfg.slice(0,reportPos),/Agenda y atención[\s\S]*?Establecimiento[\s\S]*?Cuenta y herramientas/);
});

test('login is CITHELA branded rather than tenant palette or local workspace',()=>{
 const loginCss=html.slice(html.indexOf('#screen-login{'),html.indexOf('}',html.indexOf('#screen-login{')));
 for(const css of ['--teal:#2f7d73','--teal2:#23665e','--ink:#243733','--bg:#f5f7f4'])
   assert.ok(loginCss.includes(css),'missing fixed login color '+css);
 assert.match(html,/if\(lb\)lb\.textContent='CITHELA'/);
 assert.match(html,/if\(lm\)lm\.textContent='Agenda · Organiza · Conecta'/);
 assert.match(html,/function renderProfessionalMode\(\)[\s\S]*?applyCithelaTheme\(tenant\?\.brand_theme\|\|'sage'\)/);
});

test('establishment is the primary brand in professional header without recoloring login',()=>{
 const nav=slice('<div id="screen-medico"','<div id="p-medico-agenda"');
 assert.match(nav,/id="professional-brand"/);
 assert.match(nav,/id="professional-business-name"/);
 assert.match(nav,/Agenda con CITHELA/);
 assert.match(nav,/id="professional-tenant-logo"/);
 assert.doesNotMatch(nav,/class="nb1 js-app-brand"/);
 const render=slice('function renderProfessionalMode(){','function renderReportSource(){');
 assert.match(render,/displayName=active/);
 assert.match(render,/tenant\?\.display_name/);
 assert.match(render,/businessName\.textContent=displayName/);
 assert.match(render,/classList\.toggle\('has-tenant-logo',!!url\)/);
 assert.match(html,/\.professional-brand\.has-tenant-logo::before\{display:none/);
 assert.match(html,/#screen-login\{/);
});

test('patient workspace uses larger company logo or tenant monogram and keeps names escaped',()=>{
 const portal=slice('function renderPatientPortalCards(){','async function patientRefreshPortal(){');
 assert.match(portal,/class="tenant-card-logo"/);
 assert.match(portal,/class="tenant-card-fallback"/);
 assert.match(portal,/class="sh tenant-business-title"/);
 assert.match(portal,/escHtml\(profile\.tenant_name\|\|'Establecimiento'\)/);
 assert.match(portal,/escHtml\(profile\.name\)/);
 assert.match(html,/\.patient-workspace \.tenant-card-logo,\.patient-workspace \.tenant-card-fallback\{width:64px;height:64px/);
});

test('mobile supports zoom, minimum touch targets and keyboard calendar',()=>{
 assert.match(html,/name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
 assert.doesNotMatch(html,/<meta[^>]*maximum-scale=1/);
 assert.match(html,/\.wn-btn\{width:44px;height:44px/);
 assert.match(html,/\.cday\{min-height:48px/);
 assert.match(html,/return`<button type="button" class="cday/);
 assert.match(html,/aria-pressed="\$\{sel\}"/);
 assert.match(html,/\.contact-note,\.hint,\.ops-note,\.block-meta,\.slot-note\{font-size:\.75rem/);
});

test('old local backup clearly does not represent a Supabase cloud backup',()=>{
 const reports=slice('id="p-medico-reportes"','id="p-medico-config"');
 assert.match(reports,/No respalda datos de Supabase Cloud/);
});

test('logo upload accepts iPhone image formats and prepares photos before sending to Storage',()=>{
 assert.match(html,/id="cloud-brand-logo"[^>]*accept="image\/\*,\.heic,\.heif"/);
 assert.match(html,/function imageTypeForBrand\(file\)/);
 assert.match(html,/async function prepareCloudBrandImage\(file\)/);
 assert.match(html,/file\.size>15\*1024\*1024/);
 assert.match(html,/canvas\.toBlob\(resolve,'image\/jpeg',quality\)/);
 assert.match(html,/blob\.size<=524288/);
 assert.match(html,/new File\(\[blob\],'logo\.jpg',\{type:'image\/jpeg'\}\)/);
 assert.match(html,/async function selectCloudBrandLogo\(input\)/);
 assert.match(html,/await prepareCloudBrandImage\(selected\)/);
 assert.match(html,/id="cloud-brand-feedback"[^>]*role="status"/);
 assert.match(html,/class="cloud-brand-selected"/);
 assert.match(html,/uploadBrandLogo\(\{/);
});

test('logo failures remain visible, without modifying booking or Storage policy',()=>{
 assert.match(html,/cloudBrandFeedback\('No se guardó el logo: '\+message\)/);
 assert.match(html,/cloudBrandFeedback\('Logo subido\. Vinculándolo al establecimiento…'\)/);
 assert.match(html,/cloudBrandFeedback\('Identidad visual guardada correctamente/);
 assert.match(html,/cloudBrandSelectionId/);
 assert.match(html,/cloudBrandProcessing/);
 assert.match(html,/clearCloudBrandPreview\(\)/);
});

test('operations queue summarizes pending confirmations, deposits and reminders without sending automatically',()=>{
 const agenda=slice('id="p-medico-agenda"','id="p-medico-pacientes"');
 assert.match(agenda,/id="ops-queue-summary"[^>]*role="status"/);
 assert.match(agenda,/Abrir el chat no confirma envío ni lectura/);
 assert.match(html,/const pendingCount=all.filter/);
 assert.match(html,/const depositCount=all.filter/);
 assert.match(html,/const reminderCount=all.filter/);
 assert.match(html,/class="aitem ops-queue-card"/);
 assert.match(html,/\.ops-queue-card \.aitem-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
 assert.match(html,/Esta acción NO realiza ningún cobro/);
 assert.match(html,/Abrir WhatsApp no confirma envío, recepción ni lectura/);
});
