import test from "node:test";
import assert from "node:assert/strict";
import {normalizeLocale,selectLocale,t,supportedTranslations} from "./locale.mjs";
import {cleanE164,validateAccessUrl,appendAccessLocale,createSmsDraft,smsSegments} from "./sms.mjs";
const BASE="https://spuklab.github.io/spuklab-builds/cithela/";
test("Spanish defaults; English from browser, URL or saved preference",()=>{
  assert.equal(normalizeLocale("en-US"),"en-US");
  assert.equal(selectLocale({browser:"en-US"}),"en-US");
  assert.equal(selectLocale({stored:"es-AR",browser:"en-US"}),"es-AR");
  assert.equal(selectLocale({search:"?lang=en",stored:"es-AR"}),"en-US");
  assert.equal(t("login","en-US"),"Sign in");
  assert.equal(t("login","es-AR"),"Ingresar");
  assert.ok(supportedTranslations().length>30);
});
test("only E164 numbers accepted",()=>{
  assert.equal(cleanE164("+1 (415) 555-0132"),"+14155550132");
  for(const phone of ["5551234","911","sms:+14155550000","%2B1415","555;123","+100","<script>"])
    assert.throws(()=>cleanE164(phone));
});
test("SMS contains no diagnostic data and requires explicit consent",()=>{
  assert.throws(()=>createSmsDraft({phone:"+14155550132"}));
  const r=createSmsDraft({phone:"+14155550132",clinic:"Example Dental",locale:"en",
    accessUrl:BASE,consent:true});
  assert.match(r.message,/Example Dental/);
  assert.match(r.message,/Sign in/);
  assert.match(r.uri,/^sms:\+14155550132\?body=/);
  assert.equal(r.automatic,false);
  assert.equal(r.provider,null);
  assert.doesNotMatch(r.message,/treatment|diagnosis|odontogram/);
  assert.equal(decodeURIComponent(r.uri.split("?body=")[1]),r.message);
});
test("invite link must be CITHELA and contain a personal token",()=>{
  const token="a".repeat(48);
  const r=createSmsDraft({phone:"+14155550132",purpose:"invitation",
    accessUrl:BASE+"#invite="+token+"&email=patient%40example.org",locale:"en-US",consent:true});
  assert.match(r.message,/personal/);
  assert.match(r.message,/lang=en/);
  assert.match(r.message,/invite=/);
  assert.throws(()=>createSmsDraft({phone:"+14155550132",purpose:"invitation",
    accessUrl:BASE,consent:true}));
});
test("unsafe URL schemes and lookalikes cannot be texted",()=>{
  for(const u of ["http://spuklab.github.io/spuklab-builds/cithela/","https://spuklab.github.io.evil.com/spuklab-builds/cithela/",
    "javascript:alert(1)","https://evil.example/","https://spuklab.github.io/other/"])
    assert.throws(()=>validateAccessUrl(u));
  assert.equal(appendAccessLocale(BASE,"en").includes("?lang=en"),true);
});
test("basic segment estimates distinguish ASCII and Unicode",()=>{
  assert.equal(smsSegments("A".repeat(161)).segments,2);
  assert.equal(smsSegments("á".repeat(71)).segments,2);
});
