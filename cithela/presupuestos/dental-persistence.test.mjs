import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync(new URL("../supabase/cithela_quotes_v1.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("./cloud-ui.mjs",import.meta.url),"utf8");
const html=readFileSync(new URL("./cloud.html",import.meta.url),"utf8");

test("cobertura odontológica desactivada y controlada por tenant en servidor",()=>{
  assert.match(sql,/dental_enabled boolean not null default false/);
  assert.match(sql,/check \(not dental_enabled or enabled\)/);
  assert.match(sql,/p_command='settings.get'/);
  assert.match(sql,/e\.tenant_id=p_tenant_id and e\.enabled and e\.dental_enabled/);
  assert.match(sql,/return jsonb_build_object\('ok',false,'code','dental_not_enabled'\)/);
  assert.match(ui,/state\.dentalEnabled=settings\.dentalEnabled/);
  assert.match(ui,/\$\("dental-panel"\)\.hidden=!state\.dentalEnabled/);
  assert.match(html,/id="dental-panel" hidden/);
});

test("solo se escriben campos de cobertura permitidos",()=>{
  assert.match(sql,/where k not in \('kind','provider','plan','status','covered_minor'\)/);
  assert.match(sql,/v_kind not in \('obra_social','prepaga'\)/);
  assert.match(sql,/v_dental_status not in \('sin_verificar','pendiente','autorizada','rechazada'\)/);
  assert.match(sql,/if v_covered_minor>v_subtotal-v_discount then/);
  assert.match(sql,/v_dental:=jsonb_build_object\(/);
  assert.match(sql,/v_existing\.dental_coverage is distinct from v_dental/);
  assert.match(sql,/set person_id=v_person,items=v_items,dental_coverage=v_dental/);
});

test("listado, impresión y mensajes usan snapshot del servidor",()=>{
  assert.match(sql,/q\.dental_coverage,q\.subtotal_minor/);
  assert.match(ui,/dental_coverage:.*dentalCoverage/);
  assert.match(ui,/resetDental\(quote\.dental_coverage\)/);
  assert.match(ui,/resetDental\(previous\.dental_coverage\)/);
  assert.match(ui,/\$\("print-dental"\)\.textContent=savedDentalNote\(q\)/);
  assert.match(ui,/savedDentalNote\(q\)/);
  assert.match(html,/No ingresar número de afiliación/);
});

test("no expone credenciales ni tablas a personas anónimas",()=>{
  assert.match(sql,/alter table public\.cithela_quotes enable row level security/);
  assert.match(sql,/revoke all on public\.cithela_quotes from public,anon,authenticated/);
  assert.match(sql,/revoke all on cithela_private\.cithela_quote_enablements from public,anon,authenticated/);
  assert.match(sql,/revoke all on function public\.cithela_quote_command\(uuid,text,text,jsonb\) from public,anon,authenticated/);
});
