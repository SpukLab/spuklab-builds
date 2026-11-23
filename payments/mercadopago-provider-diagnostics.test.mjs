import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProviderRead,classifyProviderTransport,safeProviderReadCode} from './mercadopago-provider-diagnostics.mjs';
test('categorizes Mercado Pago response statuses without disclosing resource identifiers',()=>{
 const examples=[
  ['/users/me',401,'mp_seller_http_401'],
  ['/preapproval/sub_abc',403,'mp_subscription_http_403'],
  ['/authorized_payments/search?preapproval_id=sub_secretID123&limit=50&offset=0',400,'mp_invoice_search_http_400'],
  ['/authorized_payments/125544443',404,'mp_invoice_http_404'],
  ['/v1/payments/998877',429,'mp_payment_http_429'],
  ['/v1/payments/998877',500,'mp_payment_http_5xx'],
 ];
 for(const [path,status,expected] of examples){
  const code=classifyProviderRead(path,status);
  assert.equal(code,expected);
  assert.equal(safeProviderReadCode(new Error(code)),expected);
  assert.equal(code.includes('secretID123')||code.includes('998877'),false);
 }
});
test('transport errors are categorized without sending payloads or secrets',()=>{
 const code=classifyProviderTransport('/authorized_payments/search?preapproval_id=abc');
 assert.equal(code,'mp_invoice_search_transport');
 assert.equal(safeProviderReadCode(new Error(code)),code);
});
test('generic unexpected exceptions never expose arbitrary messages',()=>{
 for(const failure of [new Error('access-token'),new Error('merchant_123'),null,{message:'sensitive'},'random']){
  assert.equal(safeProviderReadCode(failure),'provider_read_only_unavailable');
 }
});
