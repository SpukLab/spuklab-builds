import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {handlePilotInvitations} from './commercial/pilot-invitations-handler.mjs';

const admin='11111111-1111-4111-8111-111111111111';
const guest='22222222-2222-4222-8222-222222222222';
function request(action,payload={},headers={}){
 return new Request('https://example.supabase.co/functions/v1/cithela-pilot-invitations',{
  method:'POST',headers:{origin:'https://spuklab.github.io',
   authorization:'Bearer test-session',...headers},
  body:JSON.stringify({action,payload})
 });
}
function settings(id=admin,enabled=true){
 const calls=[];
 return {calls,opts:{enabled,adminId:admin,
  resolveUser:async()=>({id,emailConfirmed:true}),
  execute:async(userId,action,email)=>{
   calls.push({userId,action,email});
   return {ok:true,code:'test_ok',invites:[]};
  }
 }};
}
const parse=async r=>({status:r.status,...await r.json()});

test('only a verified administrator issues, lists and revokes invitations',async()=>{
 const {opts,calls}=settings();
 for(const [action,payload] of [['issue',{email:'Pro@Example.com'}],
  ['list',{}],['revoke',{email:'pro@example.com'}]]){
  const res=await parse(await handlePilotInvitations(request(action,payload),opts));
  assert.equal(res.status,200);
 }
 assert.deepEqual(calls.map(c=>[c.action,c.email]),[
  ['issue','pro@example.com'],['list',null],['revoke','pro@example.com']]);
});

test('a verified non-admin can redeem only their own server-bound invite',async()=>{
 const {opts,calls}=settings(guest);
 const res=await parse(await handlePilotInvitations(request('redeem',{}),opts));
 assert.equal(res.status,200);
 assert.deepEqual(calls,[{userId:guest,action:'redeem',email:null}]);
 const denied=await parse(await handlePilotInvitations(request('issue',{email:'x@y.com'}),opts));
 assert.equal(denied.status,403);
 assert.equal(calls.length,1);
});

test('the public endpoint rejects spoofed identities, optional invitee email and unknown actions',async()=>{
 const {opts,calls}=settings(admin);
 for(const [action,payload] of [
  ['redeem',{email:'other@example.com'}],
  ['redeem',{user_id:admin}],
  ['delete',{}],['issue',{email:'x@y.com',force:true}]
 ]){
  const res=await parse(await handlePilotInvitations(request(action,payload),opts));
  assert.equal(res.status,400);
 }
 assert.equal(calls.length,0);
});

test('fails closed on missing admin ID, unverified email, wrong origin or auth failure',async()=>{
 const {opts}=settings();
 assert.equal((await parse(await handlePilotInvitations(request('list'),{...opts,adminId:''}))).status,503);
 assert.equal((await parse(await handlePilotInvitations(request('list'),{...opts,enabled:false}))).status,503);
 assert.equal((await parse(await handlePilotInvitations(request('list'),
   {...opts,resolveUser:async()=>({id:admin,emailConfirmed:false})}))).status,403);
 assert.equal((await parse(await handlePilotInvitations(request('list',{},
   {origin:'https://attacker.test'}),opts))).status,403);
 assert.equal((await parse(await handlePilotInvitations(request('list',{},
   {authorization:''}),opts))).status,401);
 assert.equal((await parse(await handlePilotInvitations(request('list'),
   {...opts,resolveUser:async()=>{throw Error('upstream')}}))).status,503);
});

test('no browser privileges in SQL; invite redeemed against verified auth.users email',()=>{
 const base=new URL('./supabase/',import.meta.url);
 const schema=readFileSync(new URL('pilot-invitation-table-20261106.sql',base),'utf8');
 const sql=readFileSync(new URL('pilot-invitation-command-20261106.sql',base),'utf8');
 assert.match(schema,/ENABLE ROW LEVEL SECURITY/);
 assert.match(schema,/REVOKE ALL ON cithela_private\.cithela_pilot_invites/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_pilot_invitation_command/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/u\.email_confirmed_at/);
 assert.match(sql,/WHERE email=em FOR UPDATE/);
 assert.match(sql,/cithela_onboarding_grants/);
 assert.match(sql,/ON CONFLICT\(user_id\) DO UPDATE/);
 assert.match(sql,/p_action='revoke'/);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM public\.cithela_tenants/i);
});

test('professional workflow is isolated from public commercial checkout',()=>{
 const panel=readFileSync(new URL('./invitar-profesionales.html',import.meta.url),'utf8');
 const signup=readFileSync(new URL('./alta-profesional.html',import.meta.url),'utf8');
 const edge=readFileSync(new URL('./edge/cithela-pilot-invitations/index.ts',import.meta.url),'utf8');
 assert.match(panel,/cithela-pilot-invitations/);
 assert.match(signup,/action:'redeem'/);
 assert.match(signup,/alta-profesional\.html/);
 assert.match(signup,/pilotTenant=1/);
 assert.match(edge,/CITHELA_COMMERCIAL_ADMIN_USER_ID/);
 assert.match(edge,/CITHELA_PILOT_INVITES_ENABLED/);
 assert.match(edge,/auth\.getUser\(jwt\)/);
 assert.doesNotMatch(panel+signup,/SUPABASE_SERVICE_ROLE_KEY|CITHELA_MP_TEST_ACCESS_TOKEN/);
});
test('mobile page scripts have valid JavaScript syntax',()=>{
 for(const file of ['invitar-profesionales.html','alta-profesional.html']){
  const html=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source,'inline script exists');
  assert.doesNotThrow(()=>new Function(source));
 }
});


function browserInvitationPanel(result={ok:true,invites:[]}){
 const page=readFileSync(new URL('./invitar-profesionales.html',import.meta.url),'utf8');
 const script=page.split('<script>')[1]?.split('</script>')[0];
 assert.ok(script,'inline panel script');
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id)){
   nodes.set(id,{id,hidden:false,textContent:'',value:'',
    addEventListener(){},replaceChildren(...items){this.items=items;}});
  }
  return nodes.get(id);
 };
 const context=vm.createContext({
  URL,console,document:{getElementById:element,createElement:tag=>({
   tagName:tag,textContent:'',style:{},
   append(){},addEventListener(){},
   set className(v){this._className=v;}
  })},
  window:{},navigator:{},confirm:()=>false
 });
 // This library method runs in the same browser global environment as the page.
 // Regressions that shadow the standard URL constructor must fail the test.
 vm.runInContext([
  'window.supabase={',
  ' createClient: address=>{',
  '  new URL(address);',
  '  return {',
  '   auth:{getSession:async()=>({data:{session:{user:{id:"test-admin"}}},error:null})},',
  '   functions:{invoke:async()=>({data:globalThis.__mockResult,error:null})}',
  '  };',
  ' }',
  '};'
 ].join(' '),context);
 context.__mockResult=result;
 const marker='start();';
 const at=script.lastIndexOf(marker);
 assert.ok(at>=0,'initial startup invocation exists');
 const startScript=script.slice(0,at)+'globalThis.__startup=start();'+script.slice(at+marker.length);
 vm.runInContext(startScript,context);
 return {context,nodes,element};
}

test('Safari invite page does not shadow global URL and initializes authenticated session',async()=>{
 const html=readFileSync(new URL('./invitar-profesionales.html',import.meta.url),'utf8');
 assert.ok(!html.includes('const URL='),'native URL constructor cannot be shadowed');
 const page=browserInvitationPanel();
 await page.context.__startup;
 assert.equal(page.element('gate').hidden,true);
 assert.equal(page.element('content').hidden,false);
 assert.equal(page.element('items').items.length,0);
});

test('invitation backend gate is explained without suggesting password recovery',async()=>{
 const page=browserInvitationPanel({ok:false,code:'not_enabled'});
 await page.context.__startup;
 assert.equal(page.element('gate').hidden,false);
 assert.match(page.element('gate-msg').textContent,/aún no está habilitado/);
 assert.doesNotMatch(page.element('gate-msg').textContent,/contraseña/);
});
