import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const root=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("./sms-ui.mjs",import.meta.url),"utf8");
const locale=fs.readFileSync(new URL("./locale-ui.mjs",import.meta.url),"utf8");
test("new optional modules are linked without replacing existing appointment flows",()=>{
  assert.match(root,/src="\.\/international\/locale-ui\.mjs"/);
  assert.match(root,/src="\.\/international\/sms-ui\.mjs"/);
  assert.match(root,/const CITHELA_SMS_PREVIEW_ENABLED=.*smsPreview/);
  assert.match(root,/function prepareCithelaSMS\(personId/);
  assert.match(root,/CITHELA_SMS_PREVIEW_ENABLED&&wa/);
  assert.match(root,/cloud-invite-link/);
  assert.match(root,/async function cloudVerFicha\(id\)/);
});
test("the phone-OTP WhatsApp invite is not mislabeled as SMS authentication",()=>{
  const i=root.indexOf("function prepareCithelaSMS(personId");
  assert.ok(i>=0);
  const part=root.slice(i,root.indexOf("async function cloudIssueInvite(",i));
  assert.match(part,/mode==='invitation'\?\$\('cloud-invite-link'\)/);
  assert.doesNotMatch(part,/cloud-whatsapp-invite-link/);
  assert.match(ui,/No network requests, credentials, automation or inbound webhook/);
});
test("language selection is user-controlled and has no auth side effects",()=>{
  assert.match(root,/data-cithela-language="en-US"/);
  assert.match(root,/data-cithela-language="es-AR"/);
  assert.match(locale,/localStorage\.setItem\(LOCALE_KEY/);
  assert.doesNotMatch(locale,/signOut\(|auth\.signIn|rpc\(/);
});
test("manual send requires the dialog's consent and a separate click",()=>{
  assert.match(ui,/if\(!data\|\|!requireConsent\(\)\)return/);
  assert.match(ui,/window\.location\.assign\(result\.uri\)/);
  assert.doesNotMatch(ui,/fetch\(|\.rpc\(|sendSms\(/);
});
