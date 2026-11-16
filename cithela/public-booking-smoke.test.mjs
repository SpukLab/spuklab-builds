import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
for(const filename of ['reservar.html','compartir.html']){
  test(filename+' parses scripts and contains no duplicate IDs',()=>{
    const html=read(filename);
    const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m=>m[1]).filter(js=>js.trim());
    assert.ok(scripts.length>0,'Expected inline JS');
    for(const js of scripts)assert.doesNotThrow(()=>new Function(js));
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
  });
}
test('booking public flow is opt-in and email verified',()=>{
  const sql=read('sql/20261115_public_booking_pilot.sql');
  const html=read('reservar.html');
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/u\.email_confirmed_at is not null/);
  assert.match(html,/CithelaAuthCaptcha\?\.wrap\(client\)/);
  assert.match(html,/cithela_public_booking_attach/);
  assert.match(html,/cithela_patient_booking_create/);
  assert.match(html,/getUser\(\)/);
  assert.doesNotMatch(html,/window\.service_role/);
});
test('professional sharing retains explicit enable switch',()=>{
  const html=read('compartir.html');
  assert.match(html,/id="enabled" type="checkbox"/);
  assert.match(html,/cithela_public_booking_config/);
  assert.match(html,/cithela_public_booking_timezone_update/);
});

test('email verification return preserves chosen slot without leaking contact information',()=>{
  const html=read('reservar.html');
  const start=html.indexOf('function bookingRedirectUrl(){');
  const end=html.indexOf('function tenantBrandLogoUrl(x){',start);
  assert.ok(start>0&&end>start);
  const source=html.slice(start,end);
  const factory=new Function('URL','location','slug','lang','data','chosen','$',
    source+'; return bookingRedirectUrl();');
  const fields={service:{value:'service-id'},resource:{value:'staff-id'},date:{value:'2026-12-01'}};
  const value=factory(URL,{origin:'https://example.org',pathname:'/cithela/reservar.html'},
    'dentist','en',{tenant_id:'tenant-id'},'13:30',id=>fields[id]);
  const url=new URL(value);
  assert.equal(url.searchParams.get('lang'),'en');
  assert.equal(url.searchParams.get('c'),'dentist');
  assert.equal(url.searchParams.get('service'),'service-id');
  assert.equal(url.searchParams.get('resource'),'staff-id');
  assert.equal(url.searchParams.get('date'),'2026-12-01');
  assert.equal(url.searchParams.get('time'),'13:30');
  for(const secret of ['email','name','token','person'])assert.equal(url.searchParams.has(secret),false);
});

test('tenant logo is limited to immutable image path in that tenant public branding bucket',()=>{
  const html=read('reservar.html');
  const start=html.indexOf('function tenantBrandLogoUrl(x){');
  const end=html.indexOf('function applyTenantBrand(x){',start);
  assert.ok(start>0&&end>start);
  const source=html.slice(start,end);
  const logo=new Function('URL_SUPA',source+';return tenantBrandLogoUrl;')('https://example.supabase.co');
  const id='aabbccdd-1111-2222-3333-444455556666';
  const path=id+'/logo-'+'a'.repeat(32)+'.png';
  assert.match(logo({tenant_id:id,logo_object_path:path}),/cithela-branding/);
  assert.equal(logo({tenant_id:id,logo_object_path:'another-tenant/logo-'+'a'.repeat(32)+'.png'}),'');
  assert.equal(logo({tenant_id:id,logo_object_path:id+'/private.pdf'}),'');
});

test('booking sharing distinguishes expired subscription and hides inactive QR actions',()=>{
  const html=read('compartir.html');
  const sql=read('sql/20261115_public_booking_error_clarity.sql');
  assert.match(sql,/code','subscription_required'/);
  assert.match(sql,/code','services_missing'/);
  assert.match(sql,/code','resources_missing'/);
  assert.match(sql,/code','hours_missing'/);
  assert.match(html,/commercial_status==='trial_expired'/);
  assert.match(html,/El período de prueba o la suscripción no permiten nuevas reservas/);
  assert.match(html,/settings\.enabled&&settings\.commercial_can_book!==false/);
  assert.match(html,/\$\(key\)\.disabled=!active/);
  assert.match(html,/QR disponible después de activar las reservas/);
});

test('public booking keeps an accessible, subtle language switch',()=>{
  const html=read('reservar.html');
  assert.match(html,/<button id="language" type="button" aria-label="Cambiar idioma a inglés" title="English">EN<\/button>/);
  assert.match(html,/\.top button\{background:transparent;/);
  assert.doesNotMatch(html,/\.top button,\.btn\.secondary,\.step/);
  assert.match(html,/\$\('language'\)\.textContent=lang==='es'\?'EN':'ES';/);
  assert.match(html,/\$\('language'\)\.setAttribute\('aria-label'/);
  assert.match(html,/\$\('language'\)\.addEventListener\('click'/);
});

test('professional agenda exposes compact copy/share/QR only for authorized enabled workspaces',()=>{
  const html=read('index.html');
  assert.match(html,/id="professional-public-booking-shortcut" class="cithela-share-strip" hidden/);
  assert.match(html,/class="cithela-booking-shortcut__link" href="\.\/compartir\.html"/);
  assert.match(html,/id="professional-share-copy"/);
  assert.match(html,/id="professional-share-native"/);
  assert.match(html,/const shareAllowed=active&&\['owner','admin','operator'\]/);
  assert.match(html,/data\.enabled===true&&/);
  assert.match(html,/updateProfessionalBookingShareVisibility/);
  assert.match(html,/id="cfg-section-public-booking"/);
});

test('booking link name is generated from familiar business name and changing it is opt-in',()=>{
 const html=read('compartir.html');
 const start=html.indexOf('function linkNameFromBrand(name){');
 const end=html.indexOf('function updateLinkNamePreview(){',start);
 assert.ok(start>=0&&end>start);
 const linkName=new Function(html.slice(start,end)+';return linkNameFromBrand')();
 assert.equal(linkName('Consultorio odontológico'),'consultorio-odontologico');
 assert.equal(linkName('Alma y Pampa'),'alma-y-pampa');
 assert.equal(linkName('Tovar & Associates Inc'),'tovar-associates-inc');
 assert.equal(linkName('CITHELA'),'cithela-turnos');
 assert.match(html,/id="suggest-slug"/);
 assert.match(html,/Nombre de tu enlace/);
 assert.match(html,/El enlace anterior seguirá funcionando/);
 assert.match(html,/settings=x;\$\('slug'\)\.value=x.slug/);
 assert.match(html,/\$\('tenant-wrap'\)\.hidden=rows\.length===1/);
});
test('old booking link slug routes stay bound to same tenant across catalog, slots and email attach',()=>{
 const sql=read('sql/20261115_public_booking_slug_routes.sql');
 assert.match(sql,/create table if not exists public\.cithela_public_booking_slug_routes/);
 assert.match(sql,/alter table public\.cithela_public_booking_slug_routes enable row level security/);
 assert.match(sql,/revoke all on public\.cithela_public_booking_slug_routes from public,anon,authenticated/);
 assert.match(sql,/create trigger cithela_track_public_booking_slug/);
 assert.match(sql,/errcode='23505'/);
 for(const fn of ['public_booking_attach','public_booking_catalog','public_booking_slots']){
   assert.ok(sql.includes('FUNCTION cithela_private.'+fn+'('),fn+' route check');
 }
 assert.equal((sql.match(/where r\.slug=p_slug/g)||[]).length,3);
 assert.doesNotMatch(sql,/drop table public\.cithela_public_booking_settings/);
});

test('professional agenda lets authorized owners choose default booking-page language',()=>{
  const html=read('index.html');
  assert.match(html,/id="professional-booking-language" disabled/);
  assert.match(html,/Idioma inicial para pacientes/);
  assert.match(html,/onchange="changeProfessionalBookingLanguage\(this\)"/);
  assert.match(html,/id="professional-booking-language-status"/);
  assert.match(html,/publicBookingConfig,professionalBookingShare,signOut,bootstrap/);
  assert.match(html,/id="professional-booking-language-settings" hidden/);
  assert.match(html,/const manageAllowed=active&&\['owner','admin'\]/);
  assert.match(html,/if\(manageAllowed&&s\.tenant\?\.id\)void loadProfessionalBookingLanguage/);
  assert.match(html,/p_tenant_id:tenantId,\s*p_save:locale!==undefined,\s*p_locale:locale\?\?null/);
  assert.match(html,/professionalBookingLanguageMessage\('Idioma guardado/);
  assert.match(html,/field\.value=cache\.locale\|\|'es'/);
  const js=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m=>m[1]).filter(s=>s.trim());
  for(const source of js)assert.doesNotThrow(()=>new Function(source));
});

test('booking page honors professional default locale, with patient override taking priority',()=>{
  const html=read('reservar.html');
  assert.match(html,/const urlLocale=qs\.get\('lang'\)==='en'\|\|qs\.get\('lang'\)==='es'\?qs\.get\('lang'\):null/);
  assert.match(html,/if\(!urlLocale\)lang=x\.locale==='en'\?'en':'es'/);
  assert.doesNotMatch(html,/!navigator\.language\.toLowerCase\(\)\.startsWith\('en'\)/);
  assert.match(html,/lang=lang==='es'\?'en':'es';i18n\(\)/);
});


test('read-only public booking share requires tenant membership and keeps settings protected',()=>{
 const sql=read('sql/20261116_professional_booking_share.sql');
 assert.match(sql,/m\.user_id=auth\.uid\(\)/);
 assert.match(sql,/m\.role in \('owner','admin','operator'\)/);
 assert.match(sql,/t\.status='active'/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/security invoker set search_path=''/);
 assert.match(sql,/revoke all on function public\.cithela_professional_booking_share\(uuid\) from public,anon/);
 assert.match(sql,/grant execute on function public\.cithela_professional_booking_share\(uuid\) to authenticated/);
 const ui=read('compartir.html');
 assert.match(ui,/\.in\('role',\['owner','admin','operator'\]\)/);
 assert.match(ui,/\$\('settings-section'\)\.hidden=!canManage/);
 assert.match(ui,/await client\.rpc\('cithela_professional_booking_share'/);
});
