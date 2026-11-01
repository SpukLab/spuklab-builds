import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyWebhook,subscriptionBody,createMercadoPago,confirmPayment} from './mercadopago.mjs';
const now=Date.parse('2026-11-01T15:00:00Z');
const input={secret:'test-only-secret',requestId:'request-1',dataId:'ABC123',now};
const ts=String(now);
const digest=createHmac('sha256',input.secret).update(`id:abc123;request-id:request-1;ts:${ts};`).digest('hex');
const signature=`ts=${ts},v1=${digest}`;
test('valid authenticated webhook and lowercase resource id',async()=>assert.equal(await verifyWebhook({...input,signature}),true));
for(const [name,patch] of Object.entries({tampered:{dataId:'999'},wrongSecret:{secret:'other'},expired:{now:now+300001},future:{now:now-300001},missing:{secret:''},duplicate:{signature:`${signature},ts=${ts}`},badSignature:{signature:'ts=1,v1=bad'}})) {
  test(`reject ${name} webhook`,async()=>assert.equal(await verifyWebhook({...input,signature,...patch}),false));
}
const options={reference:'checkout_123',email:'test@example.com',consent:true,backUrl:'https://example.com/account',amount:18000};
test('checkout has no provider trial and requires consent',()=>{
  const body=subscriptionBody(options);assert.equal(body.status,'pending');assert.equal(body.auto_recurring.currency_id,'ARS');
  assert.equal(body.auto_recurring.free_trial,undefined);
  assert.throws(()=>subscriptionBody({...options,consent:false}),/consent_required/);
  assert.throws(()=>subscriptionBody({...options,backUrl:'http://example.com'}),/invalid_return_url/);
});
test('disabled adapter makes no calls',async()=>{
  const api=createMercadoPago({accessToken:'test',fetchImpl:()=>assert.fail('network called')});
  await assert.rejects(api.create(options),/payments_disabled/);
  await assert.rejects(api.cancel('123'),/payments_disabled/);
});
test('provider routes and cancellation are fixed and bounded',async()=>{
  const calls=[];const api=createMercadoPago({enabled:true,accessToken:'test',fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('{}');}});
  await api.cancel('abc');assert.equal(calls[0].url,'https://api.mercadopago.com/preapproval/abc');
  assert.equal(calls[0].init.method,'PUT');assert.deepEqual(JSON.parse(calls[0].init.body),{status:'canceled'});
  assert.throws(()=>api.payment('../other'),/invalid_provider_id/);
});
const expected={subscriptionId:'sub1',reference:'checkout_123',collectorId:123,amount:18000,liveMode:false,checkoutCreatedAt:'2026-11-01T14:00:00Z'};
const subscription={id:'sub1',status:'authorized',external_reference:'checkout_123',auto_recurring:{currency_id:'ARS',transaction_amount:18000,frequency:1,frequency_type:'months'}};
const payment={id:42,status:'approved',external_reference:'checkout_123',collector_id:123,currency_id:'ARS',transaction_amount:18000,live_mode:false,date_approved:'2026-11-01T14:30:00Z'};
test('server fetched payment can match checkout',()=>assert.equal(confirmPayment({expected,subscription,payment,now}),true));
for(const [name,patch] of Object.entries({pending:{status:'pending'},refunded:{status:'refunded'},wrongAmount:{transaction_amount:1},wrongCurrency:{currency_id:'USD'},wrongMerchant:{collector_id:999},wrongAccount:{external_reference:'other'},wrongEnvironment:{live_mode:true},old:{date_approved:'2026-10-30T12:00:00Z'}})) {
 test(`deny entitlement for ${name}`,()=>assert.equal(confirmPayment({expected,subscription,payment:{...payment,...patch},now}),false));
}
test('authorized subscription alone never enables paid access',()=>assert.equal(confirmPayment({expected,subscription,now}),false));
