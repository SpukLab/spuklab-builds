import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('./supabase/cithela_tenant_public_name_20261105.sql',import.meta.url),'utf8');
const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start+1);assert.ok(start>=0&&end>start);return html.slice(start,end);};

test('cloud professional sees a true public business-name control, not local preferences',()=>{
 const markup=section('id="cfg-section-business"','id="cfg-section-payments"');
 assert.match(markup,/id="cloud-tenant-name"[^>]*maxlength="160"/);
 assert.match(markup,/id="cloud-tenant-name-save"/);
 assert.match(markup,/id="cloud-tenant-name-status"[^>]*role="status"/);
 assert.match(markup,/Nombre público del establecimiento/);
 assert.match(markup,/modo local/);
 const toggle=section('function renderProfessionalMode(){','function formatCithelaComplimentaryExpiry(');
 assert.match(toggle,/localPreferences\.style\.display=active\?'none':''/);
 assert.match(toggle,/if\(active\)localPreferences\.open=false/);
});

test('public name is written via tenant-specific server RPC then cloud state is refreshed',()=>{
 const api=section('async function tenantNameUpdate(','async function tenantBrandingUpdate(');
 assert.match(api,/c\.rpc\('cithela_tenant_name_update'/);
 assert.match(api,/p_tenant_id:tenantId,p_expected_name:expectedName,p_name:name/);
 assert.match(api,/await refresh\(\)/);
 assert.doesNotMatch(api,/from\('cithela_tenants'\)\.update/);
 const save=section('async function saveCloudTenantName(){','function renderCloudBrandConfig(');
 assert.match(save,/\['owner','admin'\]/);
 assert.match(save,/input\.dataset\.tenantId!==tenant\.id/);
 assert.match(save,/await CithelaCloud\.tenantNameUpdate/);
 assert.match(save,/stale_write/);
 assert.match(save,/confirm\('¿Cambiar el nombre público/);
 assert.match(html,/tenantBrandingUpdate,tenantNameUpdate,setWorkingHours/);
});

test('patient name comes directly from the tenant and does not depend on the local browser',()=>{
 const patient=section('function renderPatientPortalCards(){','async function patientRefreshPortal(){');
 assert.match(patient,/escHtml\(profile\.tenant_name\|\|'Establecimiento'\)/);
 assert.match(patient,/Tu ficha: \$\{escHtml\(profile\.name\)\}/);
 assert.doesNotMatch(patient,/getCfg\(\)/);
});

test('SQL rejects anonymous, non-members, non-owners and invalid or stale changes',()=>{
 assert.match(sql,/v_actor uuid := auth\.uid\(\)/);
 assert.match(sql,/v_role not in \('owner','admin'\)/);
 assert.match(sql,/char_length\(v_new\) not between 1 and 160/);
 assert.match(sql,/v_current is distinct from p_expected_name/);
 assert.match(sql,/for update;/);
 assert.match(sql,/where t\.id=p_tenant_id and t\.status='active'/);
 assert.match(sql,/revoke all on function public\.cithela_tenant_name_update\(uuid,text,text\) from public,anon/);
 assert.match(sql,/grant execute on function public\.cithela_tenant_name_update\(uuid,text,text\) to authenticated/);
 assert.match(sql,/tenant_public_name_updated/);
 assert.doesNotMatch(sql,/update public\.cithela_people|update public\.cithela_appointments/i);
});
