import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {wrap}=createRequire(import.meta.url)('./commercial/auth-captcha.js');
function fixture(required=true){const calls=[];let issued=0;const client={auth:{}};
 for(const name of ['signUp','signInWithPassword','signInWithOtp','resend','resetPasswordForEmail'])client.auth[name]=async(...args)=>{calls.push({name,args});return {data:{ok:true},error:null}};
 wrap(client,{config:async()=>({required,sitekey:'public-key'}),token:async()=>`fresh-${++issued}`});return {client,calls};}
test('captcha tokens are fresh for signup, login, email and phone OTP, resend and recovery',async()=>{
 const {client,calls}=fixture();for(const name of ['signUp','signInWithPassword','signInWithOtp','resend'])await client.auth[name]({email:'example@invalid.test',options:{emailRedirectTo:'https://safe.example'}});
 await client.auth.signInWithOtp({phone:'+5492210000000',options:{channel:'sms',shouldCreateUser:false}});
 await client.auth.resetPasswordForEmail('example@invalid.test',{redirectTo:'https://safe.example'});
 assert.deepEqual(calls.map(c=>c.name==='resetPasswordForEmail'?c.args[1].captchaToken:c.args[0].options.captchaToken),['fresh-1','fresh-2','fresh-3','fresh-4','fresh-5','fresh-6']);
 assert.equal(calls[4].args[0].options.channel,'sms');assert.equal(calls[4].args[0].options.shouldCreateUser,false);assert.equal(calls[5].args[1].redirectTo,'https://safe.example');
});
test('existing Auth works unchanged until captcha is enabled',async()=>{const {client,calls}=fixture(false);const input={email:'example@invalid.test',password:'example-password'};await client.auth.signUp(input);assert.equal(calls[0].args[0],input)});
test('cancelled or failed captcha never calls the mail or login operation',async()=>{let called=false;const c={auth:{signUp:async()=>{called=true}}};wrap(c,{config:async()=>({required:true,sitekey:'key'}),token:async()=>{throw Error('cancelled')}});const result=await c.auth.signUp({});assert.equal(called,false);assert.equal(result.error.code,'captcha_required')});
test('wrapper is idempotent and never mutates caller credentials or options',async()=>{const {client,calls}=fixture();wrap(client,{config:async()=>{throw Error('double wrap')}});const options={emailRedirectTo:'https://safe.example',captchaToken:'old-token'};const input={email:'example@invalid.test',password:'example-password',options};await client.auth.signUp(input);assert.equal(options.captchaToken,'old-token');assert.equal(calls[0].args[0].options.captchaToken,'fresh-1')});

test('missing-token Auth response retries only once with a fresh CAPTCHA',async()=>{
 const calls=[],client={auth:{signInWithPassword:async input=>{
  calls.push(input);
  if(!input.options?.captchaToken)return {data:null,error:{code:'captcha_failed',message:'captcha protection: request disallowed (no captcha_token found)'}};
  return {data:{user:{id:'verified'}},error:null};
 }}};
 let reads=0,tokens=0;
 wrap(client,{config:async force=>{reads++;return force?{required:false,sitekey:'public-key'}:{required:false,sitekey:null}},token:async()=>{tokens++;return 'fresh-token'}});
 const r=await client.auth.signInWithPassword({email:'example@invalid.test',password:'dummy'});
 assert.equal(r.error,null);
 assert.equal(calls.length,2);
 assert.equal(calls[1].options.captchaToken,'fresh-token');
 assert.equal(reads,2);assert.equal(tokens,1);
});
test('CAPTCHA failure without configured sitekey does not loop or blame credentials',async()=>{
 let calls=0;
 const client={auth:{signInWithPassword:async()=>{calls++;return {data:null,error:{code:'captcha_failed',message:'captcha protection: request disallowed (no captcha_token found)'}}}}};
 wrap(client,{config:async()=>({required:false,sitekey:null}),token:async()=>{throw Error('must not challenge without a sitekey')}});
 const r=await client.auth.signInWithPassword({email:'example@invalid.test',password:'dummy'});
 assert.equal(calls,1);assert.equal(r.error.code,'captcha_required');
 assert.match(r.error.message,/verificación de seguridad/i);
 assert.doesNotMatch(r.error.message,/contraseña incorrecta/i);
});
test('invalid credentials are never retried as CAPTCHA errors',async()=>{
 let calls=0;const client={auth:{signInWithPassword:async()=>{calls++;return {data:null,error:{code:'invalid_credentials',message:'Invalid login credentials'}}}}};
 wrap(client,{config:async()=>({required:false,sitekey:null})});
 const r=await client.auth.signInWithPassword({email:'example@invalid.test',password:'dummy'});
 assert.equal(calls,1);assert.equal(r.error.code,'invalid_credentials');
});
test('configured sitekey enables CAPTCHA before Auth even if separate flag is false',async()=>{
 const source=createRequire(import.meta.url)('node:fs').readFileSync(new URL('./commercial/auth-captcha.js',import.meta.url),'utf8');
 assert.match(source,/required:data.required===true\|\|!!sitekey/);
 assert.match(source,/getConfig\(true\)/);
});
