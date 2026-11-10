import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('./commercial/admin-auth.js',import.meta.url),'utf8');
test('professional session cannot authenticate administration or be overwritten by it',async()=>{
 const sessions=new Map([['professional',{user:{id:'professional'}}]]);
 let options;
 const window={supabase:{createClient(_url,_key,config){
  options=config.auth;const key=options.storageKey;
  return {auth:{getSession:async()=>({data:{session:sessions.get(key)||null}}),
   signOut:async({scope})=>{assert.equal(scope,'local');sessions.delete(key);return {}},
   signInWithPassword:async()=>{const session={user:{id:'admin'}};sessions.set(key,session);return {data:{session}}}}};
 }}};
 runInNewContext(script,{window});
 const client=window.CithelaAdminAuth.createClient('https://example.supabase.co','public');
 assert.equal((await client.auth.getSession()).data.session,null);
 assert.equal(options.detectSessionInUrl,false);
 assert.equal(options.storageKey,'cithela-platform-admin-auth-v1');
 await client.auth.signInWithPassword({});
 sessions.set('professional',{user:{id:'another-professional'}});
 assert.equal((await window.CithelaAdminAuth.requireSession(client,()=>{throw Error('Unexpected login form')})).user.id,'admin');
 await client.auth.signOut({scope:'local'});
 assert.equal(sessions.get('professional').user.id,'another-professional');
 assert.equal(window.CithelaAdminAuth.createClient('https://example.supabase.co','public'),client);
});
test('both admin routes use the dedicated client while server-side permissions remain required',()=>{
 for(const file of ['comercial-admin.html','invitar-profesionales.html']){
  const html=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  assert.match(html,/CithelaAdminAuth.createClient/);
  assert.match(html,/CithelaAdminAuth.requireSession/);
  assert.doesNotMatch(html,/window.supabase.createClient\(/);
 }
});

test('professional and onboarding exits do not revoke administrative refresh sessions',()=>{
 for(const file of ['index.html','alta-profesional.html','alta-whatsapp.html']){
  const html=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  assert.doesNotMatch(html,/\.auth\.signOut\(\)/);
  assert.match(html,/\.auth\.signOut\(\{scope:'local'\}\)/);
 }
});
