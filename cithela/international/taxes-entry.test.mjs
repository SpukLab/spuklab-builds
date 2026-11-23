import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const demo=readFileSync(new URL('./taxes-preview.html',import.meta.url),'utf8');

test('Taxes preview is opt-in and appears only in existing professional settings',()=>{
 assert.match(index,/id="cithela-utah-taxes-preview-entry"\s+hidden/);
 assert.match(index,/id="p-medico-config"/);
 const section=index.slice(index.indexOf('id="p-medico-config"'),index.indexOf('id="screen-paciente"'));
 assert.match(section,/id="cithela-utah-taxes-preview-entry"/);
 assert.match(index,/const CITHELA_TAXES_PREVIEW_ENABLED=new URLSearchParams\(location\.search\)\.get\('taxesPreview'\)==='1'/);
 assert.match(index,/panel\.hidden=!\(CITHELA_TAXES_PREVIEW_ENABLED&&professionalCloudReady\(\)\)/);
 assert.match(index,/if\(sc==='medico'&&id==='config'\)\{\s*cargarConfig\(\);\s*updateCithelaTaxesPreviewEntry\(\)/);
 assert.match(index,/target="_blank" rel="noopener noreferrer"/);
});

test('pilot link points to real standalone file; no tax field or browser storage in preview',()=>{
 assert.match(index,/href="\.\/international\/taxes-preview\.html"/);
 assert.match(demo,/script type="module" src="\.\/taxes-preview\.mjs"/);
 assert.match(index,/No ingreses información de contribuyentes/);
 assert.match(index,/no consulta pacientes, documentos ni cobros/);
 assert.doesNotMatch(demo,/<input[^>]+type="file"/);
});

test('professional demo gate does not change session, tenant or data operations',()=>{
 const i=index.indexOf('function updateCithelaTaxesPreviewEntry()');
 const j=index.indexOf('function professionalCloudWritable()',i);
 assert.ok(i!==-1&&j>i);
 const gate=index.slice(i,j);
 assert.doesNotMatch(gate,/\.rpc|fetch\(|localStorage|sessionStorage|signIn|insert\(|update\(|upsert\(|delete\(/i);
 assert.match(gate,/professionalCloudReady\(\)/);
});