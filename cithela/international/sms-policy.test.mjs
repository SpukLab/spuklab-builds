import test from "node:test";
import assert from "node:assert/strict";
import {AUTOMATED_SMS_DEFAULT_ENABLED,classifyInboundKeyword,evaluateAutomatedSms} from "./sms-policy.mjs";
const URL="https://spuklab.github.io/spuklab-builds/cithela/";
const consent={channel:"sms",phone:"+14155550132",recordedAt:"2026-11-15T00:00:00Z",evidenceReference:"test-event-1"};
const base={tenantEnabled:true,providerApproved:true,registeredSender:true,recipientPhone:"+14155550132",
  consent,blocklisted:false,dailyRemaining:10,templateKey:"booking_access",portalUrl:URL,region:"US"};
test("SMS outbound feature is disabled by default",()=>{
  assert.equal(AUTOMATED_SMS_DEFAULT_ENABLED,false);
  assert.equal(evaluateAutomatedSms({...base,tenantEnabled:false}).reason,"tenant_disabled");
});
test("STOP keywords and HELP are parsed before any automated reply",()=>{
  for(const word of ["STOP","stop.","UNSUBSCRIBE","CANCEL","QUIT","END","STOPALL"])
    assert.equal(classifyInboundKeyword(word),"opt_out");
  assert.equal(classifyInboundKeyword("Help"),"help");
  assert.equal(classifyInboundKeyword("start"),"opt_in_request");
  assert.equal(classifyInboundKeyword("Need help rescheduling"),"ordinary");
});
test("US sender registration, consent and opt-out are required",()=>{
  assert.equal(evaluateAutomatedSms({...base,providerApproved:false}).reason,"sender_unregistered");
  assert.equal(evaluateAutomatedSms({...base,registeredSender:false}).reason,"sender_unregistered");
  assert.equal(evaluateAutomatedSms({...base,blocklisted:true}).reason,"opted_out");
  assert.equal(evaluateAutomatedSms({...base,consent:{...consent,evidenceReference:""}}).reason,"consent_missing");
  assert.equal(evaluateAutomatedSms({...base,recipientPhone:"+5492211000000"}).reason,"non_us_number");
});
test("quotas, approved templates, and trusted access URL are mandatory",()=>{
  assert.equal(evaluateAutomatedSms({...base,dailyRemaining:0}).reason,"daily_limit");
  assert.equal(evaluateAutomatedSms({...base,templateKey:"promo"}).reason,"unapproved_template");
  assert.equal(evaluateAutomatedSms({...base,portalUrl:"https://evil.example"}).reason,"invalid_url");
  assert.equal(evaluateAutomatedSms(base).ok,true);
});
