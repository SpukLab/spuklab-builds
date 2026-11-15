import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root=new URL("../index.html",import.meta.url);
const main=fs.readFileSync(root,"utf8");
const ui=fs.readFileSync(new URL("./cloud-ui.mjs",import.meta.url),"utf8");
const adapter=fs.readFileSync(new URL("./cloud.mjs",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("./cloud.html",import.meta.url),"utf8");
const sql=fs.readFileSync(new URL("../supabase/cithela_quotes_v1.sql",import.meta.url),"utf8");

test("patient history keeps async behavior",()=>{
  assert.match(main,/async function cloudVerFicha\(id\)\{/);
  assert.match(main,/function openCithelaQuoteForPerson\(personId\)\{/);
});
test("the quote action is gated inside the patient record, without a sixth tab",()=>{
  assert.match(main,/get\('quotesPreview'\)==='1'/);
  assert.match(main,/CITHELA_QUOTES_PREVIEW_ENABLED&&professionalCloudWritable\(\)/);
  assert.match(main,/Preparar presupuesto<\/button>/);
  assert.doesNotMatch(main,/id="medico-tab-presupuestos"/);
});
test("patient handoff selects only a person in the currently-authorized tenant",()=>{
  assert.match(ui,/state\.people\.some\(p=>p\.id===target\)/);
  assert.match(ui,/await refreshQuotes\(\)/);
});
test("frontend does not access quote tables directly or include secret API keys",()=>{
  assert.doesNotMatch(adapter,/\.from\(["']cithela_quotes["']\)/);
  assert.doesNotMatch(adapter,/service_role|sb_secret_/i);
  assert.match(adapter,/\.rpc\("cithela_quote_command"/);
});
test("production data stays inaccessible without manual tenant enablement",()=>{
  assert.match(sql,/cithela_private\.cithela_quote_enablements/);
  assert.match(sql,/enabled=true/);
  assert.match(sql,/code','feature_disabled'/);
  assert.match(sql,/revoke all on public\.cithela_quotes from public,anon,authenticated/);
  assert.match(sql,/enable row level security/);
});
test("PDF and WhatsApp are prepared only from saved snapshots",()=>{
  assert.match(ui,/if\(!storedReady\(\)\)return;/);
  assert.match(ui,/const q=state\.current/);
  assert.match(html,/id="print-quote"/);
  assert.match(html,/id="prepare-share"/);
});
