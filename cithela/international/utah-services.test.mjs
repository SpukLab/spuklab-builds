import test from "node:test";
import assert from "node:assert/strict";
import {UTAH_TENANT_DEFAULTS,UTAH_SERVICE_PRESETS,safeServiceCatalog,serviceGuidance,taxAppointmentWindow} from "./utah-services.mjs";

test("Utah pilot defaults use local time, USD, bilingual support, SMS off",()=>{
 assert.equal(UTAH_TENANT_DEFAULTS.timeZone,"America/Denver");
 assert.equal(UTAH_TENANT_DEFAULTS.currency,"USD");
 assert.equal(UTAH_TENANT_DEFAULTS.secondaryLocale,"es-AR");
 assert.equal(UTAH_TENANT_DEFAULTS.automatedSmsEnabled,false);
 assert.equal(UTAH_TENANT_DEFAULTS.taxDataCollectionEnabled,false);
});
test("tax and insurance services have realistic durations and public labels",()=>{
 const catalog=safeServiceCatalog();
 assert.equal(catalog.length,6);
 assert.equal(catalog.filter(x=>x.category==="tax").length,3);
 assert.equal(catalog.filter(x=>x.category==="insurance").length,3);
 for(const item of catalog){
  assert.ok(item.name&&item.nameEs);
  assert.ok(item.durationMin>=20&&item.durationMin<=60);
  assert.equal("initialChecklist" in item,false);
 }
});
test("tax guidance never requests uploading taxpayer records or calculates credits",()=>{
 const doc=serviceGuidance("tax-2026");
 assert.ok(doc.items.some(x=>x.includes("W-2")));
 assert.match(doc.disclaimer,/Do not send SSNs/);
 assert.equal(doc.collectionEnabled,false);
 assert.throws(()=>serviceGuidance("fake"));
});
test("tax-year timeline uses verified 2027 deadlines but no invented IRS opening",()=>{
 const window=taxAppointmentWindow();
 assert.equal(window.employerW2Due,"2027-02-01");
 assert.equal(window.utahIndividualReturnDue,"2027-04-15");
 assert.equal(window.irsSeasonStart,"not_announced");
});
