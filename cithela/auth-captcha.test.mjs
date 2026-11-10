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
