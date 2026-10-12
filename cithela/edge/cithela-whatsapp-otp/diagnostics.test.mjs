import test from "node:test";
import assert from "node:assert/strict";
import {metaRecipient,safeMetaError,META_TEST_SENDER_ID} from "./diagnostics.mjs";
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
test("Meta errors are summarized without raw body",()=>{
 assert.equal(safeMetaError(400,{error:{code:131005,message:"private info"}}),"meta_code_131005");
 assert.equal(safeMetaError(401,{error:{message:"private info"}}),"meta_http_401");
});
