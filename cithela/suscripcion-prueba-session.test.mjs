import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('./suscripcion-prueba.html',import.meta.url),'utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(source,'pilot page contains inline controller');
const TENANT='e680ebd3-a031-4968-905a-e829ab3b5dfe';
const OWNER={id:'owner-1',email:'alma.y.pampa@gmail.com',email_confirmed_at:'2026-11-01T00:00:00Z'};
function launch({initialUser=null,signinError=null,membershipTenant=TENANT}={}){
 const elements=new Map(),events=new Map(),calls=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   id,hidden:id==='auth-access'||id==='pilot-checkout'||id==='mp-link',
   disabled:true,checked:false,textContent:'',value:id==='owner-password'?'test-pw':'',
   addEventListener(event,fn){events.set(id+':'+event,fn);}
  });
  return elements.get(id);
 };
 let currentUser=initialUser;
 const query={
  select(){return this;},eq(){return this;},
  then(resolve,reject){return Promise.resolve({data:[{tenant_id:membershipTenant,role:'owner'}],error:null}).then(resolve,reject);}
 };
 const client={
  auth:{
   async getUser(){calls.push('getUser');return {data:{user:currentUser},error:null};},
   async signInWithPassword(creds){
    calls.push('signIn');
    assert.equal(creds.email,OWNER.email);
    assert.equal(creds.password,'test-pw');
    if(signinError)return {error:signinError};
    currentUser=OWNER;return {error:null};
   }
  },
  from(table){assert.equal(table,'cithela_tenant_memberships');return query;},
  functions:{invoke(){calls.push('edgeInvocation');throw Error('Should not invoke an Edge function during auth');}}
 };
 const context={
  window:{
   supabase:{createClient:()=>client},
   CithelaAuthCaptcha:{wrap(){calls.push('captchaWrapped');}},
   addEventListener:()=>{}
  },
  document:{
   getElementById:el,addEventListener:()=>{},visibilityState:'visible'
  },
  URL,Response,console
 };
 vm.runInNewContext(source,context,{filename:'suscripcion-prueba.html',timeout:3000});
 return {elements:el,events,calls,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('missing browser session exposes direct CITHELA login instead of blocking forever',async()=>{
 const app=launch();await app.flush();
 assert.equal(app.elements('auth-access').hidden,false);
 assert.match(app.elements('identity').textContent,/No hay sesión/);
 assert.equal(app.elements('get-link').disabled,true);
 assert.equal(app.calls.includes('edgeInvocation'),false);
});
test('owner may sign in on pilot page with shared CAPTCHA and retrieve existing link',async()=>{
 const app=launch();await app.flush();
 await app.events.get('pilot-login:submit')({preventDefault(){}});
 assert.equal(app.elements('auth-access').hidden,true);
 assert.equal(app.elements('get-link').disabled,false);
 assert.equal(app.elements('owner-password').value,'');
 assert.equal(app.elements('tenant').textContent,'Establecimiento: Alma y Pampa · modo interno');
 assert.equal(app.calls.filter(x=>x==='signIn').length,1);
 assert.equal(app.calls.includes('captchaWrapped'),true);
 assert.equal(app.calls.includes('edgeInvocation'),false);
});
test('wrong credentials never unlock subscription actions',async()=>{
 const app=launch({signinError:{code:'invalid_credentials',message:'invalid'}});
 await app.flush();
 await app.events.get('pilot-login:submit')({preventDefault(){}});
 assert.equal(app.elements('auth-access').hidden,false);
 assert.equal(app.elements('get-link').disabled,true);
 assert.equal(app.calls.includes('edgeInvocation'),false);
});
test('authenticated person without Alma ownership cannot use subscription tools',async()=>{
 const app=launch({initialUser:OWNER,membershipTenant:'another-tenant'});await app.flush();
 assert.equal(app.elements('get-link').disabled,true);
 assert.match(app.elements('result').textContent,/reservado/);
 assert.equal(app.calls.includes('edgeInvocation'),false);
});
