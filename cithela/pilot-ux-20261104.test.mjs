import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const portion=(start,end)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a);
 assert.ok(a>=0&&b>a,'Missing expected markup region');
 return html.slice(a,b);
};

test('new pilot UX keeps application JavaScript parsable and HTML identifiers unique',()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 assert.doesNotThrow(()=>new Function(script));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size);
});

test('appointment cards retain primary actions and expand secondary ones in both modes',()=>{
 const actions=portion("const el=$('agenda-list');","function renderAgendaHistory(");
 assert.equal((actions.match(/<details class="agenda-card-more">/g)||[]).length,2);
 assert.equal((actions.match(/<summary>Más acciones<\/summary>/g)||[]).length,2);
 assert.equal((actions.match(/class="aitem-actions agenda-card-actions"/g)||[]).length,2);
 assert.match(actions,/cloudConfirmAppointment/);
 assert.match(actions,/cloudOpenWhatsApp/);
 assert.match(actions,/cloudOpenDeposit/);
 assert.match(actions,/cloudMarkOutcome/);
 assert.match(actions,/cloudCancelAppointment/);
 assert.match(actions,/markReminderSent/);
 assert.match(actions,/cancelTurno/);
 assert.match(html,/\.agenda-card-more>summary:focus-visible/);
 assert.match(html,/@media\(max-width:600px\)[\s\S]*?\.agenda-card-secondary \.mb/);
});

test('Meta connectivity diagnostics are not inside the daily messages tab',()=>{
 const messages=portion('id="p-medico-mensajes"','id="p-medico-reportes"');
 const infra=portion('id="cfg-section-infrastructure"','id="cfg-section-security"');
 assert.doesNotMatch(messages,/Diagnóstico de conexión Meta/);
 assert.match(infra,/Diagnóstico de conexión Meta \(avanzado\)/);
 assert.match(infra,/id="cloud-wa-connection-status"/);
 assert.match(infra,/id="cloud-wa-otp-template-status"/);
 assert.match(messages,/id="cloud-wa-pilot"/);
});

test('service status follows day-to-day settings instead of displacing agenda controls',()=>{
 const settings=portion('id="p-medico-config"','<div class="byline">');
 assert.ok(settings.indexOf('id="cfg-section-hours"')<settings.indexOf('id="cithela-commercial-panel"'));
 assert.ok(settings.indexOf('id="cithela-commercial-panel"')<settings.indexOf('id="cfg-section-cloud"'));
 assert.match(settings,/Configuración del modo local \(sin sincronización\)/);
});

test('patient access and workspace identify purpose and account without changing authorization',()=>{
 assert.match(html,/Ingresá el correo que usaste para reservar o recibir la invitación/);
 assert.match(html,/Continuar por correo/);
 assert.match(html,/Vincular WhatsApp \(opcional\)/);
 const card=portion('function renderPatientPortalCards(){','async function patientRefreshPortal(){');
 assert.match(card,/tenant-card-eyebrow">Establecimiento donde reservás/);
 assert.match(card,/tenant-business-title/);
 assert.match(card,/Tu ficha: \$\{escHtml\(profile\.name\)\}/);
 assert.match(card,/escHtml\(profile\.tenant_name\|\|'Establecimiento'\)/);
 assert.match(html,/patientSwitchAccount\(\)/);
 assert.match(html,/patientNoLinkedProfile/);
});
