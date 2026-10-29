import test from "node:test";
import assert from "node:assert/strict";
import {hookRecipientPhone,metaRecipient,safeMetaError,META_TEST_SENDER_ID} from "./diagnostics.mjs";
test("Meta sandbox Argentine recipient is normalized without mutating identity",()=>{
 const phone="+5492215723664";
 assert.equal(metaRecipient(phone,META_TEST_SENDER_ID),"542215723664");
 assert.equal(phone,"+5492215723664");
});
test("normal production Argentine number is not rewritten",()=>{
 assert.equal(metaRecipient("+5492215723664","production-number"),"5492215723664");
});
test("other countries and malformed numbers",()=>{
 assert.equal(metaRecipient("+12025550123",META_TEST_SENDER_ID),"12025550123");
 assert.throws(()=>metaRecipient("123",META_TEST_SENDER_ID),/invalid_phone/);
});
test("Supabase Auth hook strips plus without changing destination",()=>{
 assert.equal(metaRecipient("5492215723664","production-number"),"5492215723664");
 assert.equal(metaRecipient("5492215723664",META_TEST_SENDER_ID),"542215723664");
 assert.equal(metaRecipient("12025550123","production-number"),"12025550123");
 assert.throws(()=>metaRecipient("++5492215723664","production-number"),/invalid_phone/);
 assert.throws(()=>metaRecipient("","production-number"),/invalid_phone/);
});
test("Meta errors are summarized without raw body",()=>{
 assert.equal(safeMetaError(400,{error:{code:131005,message:"private info"}}),"meta_code_131005");
 assert.equal(safeMetaError(401,{error:{message:"private info"}}),"meta_http_401");
});

test("phone_change sends OTP to signed sms.phone rather than old empty user.phone",()=>{
 assert.equal(hookRecipientPhone({user:{phone:""},sms:{phone:"5492211234567",otp:"123456"}}),"5492211234567");
 assert.equal(hookRecipientPhone({user:{phone:"5492211111111"},sms:{phone:"+5492211234567",otp:"123456"}}),"+5492211234567");
});
test("ordinary sign-in supports sms.phone and legacy user.phone",()=>{
 assert.equal(hookRecipientPhone({sms:{phone:"5492211234567",otp:"123456"},user:{phone:"5492211234567"}}),"5492211234567");
 assert.equal(hookRecipientPhone({user:{phone:"+5492211234567"},sms:{otp:"123456"}}),"+5492211234567");
});
test("malformed or missing destinations fail closed before contacting Meta",()=>{
 assert.throws(()=>hookRecipientPhone({user:{phone:""},sms:{otp:"123456"}}),/invalid_phone/);
 assert.throws(()=>hookRecipientPhone({user:{phone:"5492211234567"},sms:{phone:"not_a_phone"}}),/invalid_phone/);
});
