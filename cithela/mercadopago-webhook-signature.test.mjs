import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyMercadoPagoSignature} from './payments/mercadopago-webhook-signature.mjs';

const secret='private-server-webhook-secret-only-for-local-tests';
const dataId='abc-123',requestId='d4e5f6-test-request',ts='1783101234000';
const enc=new TextEncoder();
async function signed({id=dataId,req=requestId,timestamp=ts,signingSecret=secret}={}){
  const key=await crypto.subtle.importKey('raw',enc.encode(signingSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const msg=`id:${id};request-id:${req};ts:${timestamp};`;
  const h=await crypto.subtle.sign('HMAC',key,enc.encode(msg));
  const hex=Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('');
  return new Request('https://cithela.example.test/hooks?type=subscription_preapproval&data.id='+encodeURIComponent(id),{
    method:'POST',headers:{'x-request-id':req,'x-signature':`ts=${timestamp},v1=${hex}`}
  });
}

test('accepts valid Mercado Pago webhook HMAC, without network calls',async()=>{
  const req=await signed();
  assert.equal(await verifyMercadoPagoSignature(req,secret),true);
  assert.equal(await verifyMercadoPagoSignature(req,'the-wrong-server-side-secret'),false);
});
test('rejects tampered request id, resource id, signature or timestamp',async()=>{
  const good=await signed();
  const headerCopy=new Headers(good.headers);
  headerCopy.set('x-request-id','tampered-id');
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:headerCopy}),secret),false);
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url.replace(dataId,'another-id'),{headers:good.headers}),secret),false);
  const sigHeader=new Headers(good.headers);
  sigHeader.set('x-signature',sigHeader.get('x-signature').replace('ts='+ts,'ts=1783101234001'));
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:sigHeader}),secret),false);
  const badSig=new Headers(good.headers);
  badSig.set('x-signature',badSig.get('x-signature').replace(/v1=[0-9a-f]{64}/,'v1='+'0'.repeat(64)));
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:badSig}),secret),false);
});
test('rejects duplicated IDs and missing or malformed signatures',async()=>{
  const good=await signed();
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url+'&data.id=extra',{headers:good.headers}),secret),false);
  assert.equal(await verifyMercadoPagoSignature(new Request('https://cithela.example.test/hooks',{headers:good.headers}),secret),false);
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url),secret),false);
  const duplicated=new Headers(good.headers);
  duplicated.set('x-signature',duplicated.get('x-signature')+',ts=1783101234000');
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:duplicated}),secret),false);
  const malformed=new Headers(good.headers);
  malformed.set('x-signature','ts=bad,v1=xyz');
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:malformed}),secret),false);
});
test('signature parser permits order of signature fields to vary',async()=>{
  const good=await signed();
  const copy=new Headers(good.headers),sig=copy.get('x-signature').split(',');
  copy.set('x-signature',sig.reverse().join(','));
  assert.equal(await verifyMercadoPagoSignature(new Request(good.url,{headers:copy}),secret),true);
});
test('secret remains a server argument, no entitlement mutation and no checkout code',()=>{
  const src=readFileSync(new URL('./payments/mercadopago-webhook-signature.mjs',import.meta.url),'utf8');
  assert.match(src,/server-only|Server-only/);
  assert.match(src,/cryptoProvider\.subtle\.verify\('HMAC'/);
  assert.match(src,/id:\$\{dataId\};request-id:\$\{requestId\};ts:\$\{attrs\.ts\};/);
  assert.doesNotMatch(src,/fetch\(|localStorage|service_role|SUPABASE_SERVICE_ROLE_KEY|MP_ACCESS_TOKEN|\.update\(|\.insert\(/);
  assert.doesNotMatch(src,/api\.mercadopago\.com|createCheckout|activate_subscription/);
});
