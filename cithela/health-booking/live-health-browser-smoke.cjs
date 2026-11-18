// Browser test with fake data only. No network, credentials, or Supabase changes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const tenant='11111111-1111-4111-8111-111111111111';
const service='22222222-2222-4222-8222-222222222222';
const resource='33333333-3333-4333-8333-333333333333';
const person='44444444-4444-4444-8444-444444444444';
const rate='55555555-5555-4555-8555-555555555555';
async function mock(page,health=true){
 await page.addInitScript(({tenant,service,resource,person,rate,health})=>{
  window.__calls=[];
  window.supabase={createClient:(endpoint)=>{
   // Replica the SDK's real URL validation. A top-level `const URL`
   // in the page would shadow native URL and raise "Provided URL is malformed".
   try{
     const parsed=new URL(endpoint);
     if(parsed.protocol!=='https:'||parsed.hostname!=='mcqknmqhtmihegmifuka.supabase.co')
       throw Error('Unexpected Supabase host');
   }catch{throw Error('Invalid supabaseUrl: Provided URL is malformed.');}
   return ({
   auth:{
    async getUser(){return {data:{user:{id:'fake-identity',email:'fake@example.invalid',
      email_confirmed_at:'2026-11-01T00:00:00Z'}},error:null}},
    async signInWithOtp(){return {error:null}},
    async signOut(){return {error:null}},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}
   },
   async rpc(name,args){
    window.__calls.push({name,args});
    let data;
    if(name==='cithela_public_booking_catalog')data={
      ok:true,tenant_id:tenant,name:'Consultorio ficticio',timezone:'America/Argentina/Buenos_Aires',
      locale:'es',services:[{id:service,name:'Consulta',duration_min:30,deposit_amount_minor:0,deposit_currency:'ARS'}],
      resources:[{id:resource,name:'Profesional de prueba'}]
    };
    else if(name==='cithela_public_booking_slots')data={ok:true,slots:['10:00','10:30']};
    else if(name==='cithela_health_public_rates')data={ok:true,enabled:health,rates:health?[
      {id:rate,kind:'obra_social',provider:'Entidad ficticia',plan:'Plan de prueba',
       price_status:'orientativo',amount_minor:150000,version:3,valid_until:'2027-12-31'},
      {id:'66666666-6666-4666-8666-666666666666',kind:'particular',provider:'',plan:'',
       price_status:'orientativo',amount_minor:300000,version:1,valid_until:null}
    ]:[]};
    else if(name==='cithela_public_booking_attach')data={ok:true,person_id:person};
    else if(name==='cithela_health_booking_create'||name==='cithela_patient_booking_create'){
      data={ok:true,code:'patient_booking_created',appointment:{id:'fake-appointment'}};
    }else if(name==='cithela_health_my_accounts')data={
      ok:true,accounts:[{tenant_id:tenant,name:'Consultorio ficticio',role:'owner'}]};
    else if(name==='cithela_health_rates_admin'){
      data=args.p_action==='list'?{ok:true,enabled:false,
       services:[{id:service,name:'Consulta',duration_min:30}],
       rates:[]}:{ok:true,code:'saved',id:rate,version:1};
    }
    else data={ok:false,code:'unknown_rpc'};
    return {data,error:null};
   }
  });}};
 },{tenant,service,resource,person,rate,health});
 await page.route(/^https?:\/\//,route=>route.abort());
}
async function testBooking(browser,health){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',x=>errors.push(x.message));
 await mock(page,health);
 const url=pathToFileURL(path.join(__dirname,'..','reservar.html')).href+'?c=consultorio-prueba';
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#step-service').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.__calls.some(x=>x.name==='cithela_health_public_rates'));
 if(health){
  await page.locator('#health-panel').waitFor({state:'visible'});
  await page.locator('#health-kind').selectOption('obra_social');
  await page.locator('#health-rate').selectOption(rate);
  assert.equal(await page.locator('#health-consent-line').isHidden(),false);
  await page.locator('#health-consent').check();
  assert.match(await page.locator('#health-price').textContent(),/1\.500/);
 }else{
  assert.equal(await page.locator('#health-panel').isHidden(),true);
 }
 await page.locator('#slots button').first().click();
 await page.locator('#full-name').fill('Paciente de prueba');
 await page.locator('#book').click();
 await page.locator('#success').waitFor({state:'visible'});
 const calls=await page.evaluate(()=>window.__calls);
 const made=calls.filter(x=>x.name.endsWith('booking_create'));
 assert.equal(made.length,1);
 assert.equal(made[0].name,health?'cithela_health_booking_create':'cithela_patient_booking_create');
 if(health){
  assert.equal(made[0].args.p_rate_id,rate);
  assert.equal(made[0].args.p_rate_version,3);
  assert.equal(made[0].args.p_payload.service_id,service);
  assert.equal(made[0].args.p_payload.coverage_consent,true);
  assert.equal(Object.hasOwn(made[0].args.p_payload,'amount_minor'),false);
 }
 assert.ok(errors.length===0,'browser errors: '+errors.join(' | '));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'mobile overflow');
 await page.close();
 console.log('PASS public booking health='+health);
}
async function testAdmin(browser){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mock(page,true);
 const url=pathToFileURL(path.join(__dirname,'..','configurar-coberturas.html')).href;
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#editor').waitFor({state:'visible'});
 assert.match(await page.locator('#preview-price').textContent(),/Todavía no definiste un importe/);
 await page.locator('#amount').fill('importe incorrecto');
 assert.match(await page.locator('#preview-price').textContent(),/Revisá el formato del importe/);
 await page.locator('#amount').fill('');
 assert.match(await page.locator('#preview-price').textContent(),/Todavía no definiste un importe/);
 assert.equal(await page.evaluate(()=>typeof URL),'function','native URL constructor must remain accessible');
 assert.equal(await page.evaluate(()=>new URL('https://mcqknmqhtmihegmifuka.supabase.co').hostname),
   'mcqknmqhtmihegmifuka.supabase.co');
 await page.locator('#kind').selectOption('obra_social');
 await page.locator('#provider').fill('Entidad ficticia');
 await page.locator('#plan').fill('Plan de prueba');
 await page.locator('#amount').fill('1234,50');
 await page.locator('#save').click();
 await page.waitForFunction(()=>window.__calls.some(x=>x.name==='cithela_health_rates_admin'&&x.args.p_action==='upsert'));
 const data=await page.evaluate(()=>window.__calls.find(x=>x.name==='cithela_health_rates_admin'&&x.args.p_action==='upsert'));
 assert.equal(data.args.p_payload.amount_minor,123450);
 assert.equal(data.args.p_payload.kind,'obra_social');
 assert.equal(data.args.p_payload.provider,'Entidad ficticia');
 assert.equal(data.args.p_payload.expected_version,0);
 assert.ok(errors.length===0,'admin browser errors: '+errors.join(' | '));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),'admin mobile overflow');
 await page.close();
 console.log('PASS authenticated professional editor draft');
}
async function testSdkUnavailable(browser){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:\/\//,route=>route.abort());
 await page.goto(pathToFileURL(path.join(__dirname,'..','configurar-coberturas.html')).href,
    {waitUntil:'domcontentloaded'});
 await page.locator('#session-help').waitFor({state:'visible',timeout:16000});
 assert.match(await page.locator('#notice').textContent(),/No pudimos cargar el acceso de CITHELA/);
 assert.equal(await page.locator('#session-retry').isVisible(),true);
 assert.equal(errors.length,0,'no JavaScript errors when both CDN resources fail');
 await page.close();
 console.log('PASS iPhone: sin CDN muestra recuperación sin pantalla bloqueada');
}
async function testNoSession(browser){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.addInitScript(()=>{
  window.supabase={createClient:(endpoint)=>{
   // Replica the SDK's real URL validation. A top-level `const URL`
   // in the page would shadow native URL and raise "Provided URL is malformed".
   try{
     const parsed=new URL(endpoint);
     if(parsed.protocol!=='https:'||parsed.hostname!=='mcqknmqhtmihegmifuka.supabase.co')
       throw Error('Unexpected Supabase host');
   }catch{throw Error('Invalid supabaseUrl: Provided URL is malformed.');}
   return ({
    auth:{async getUser(){return {data:{user:null},error:null}}},
    rpc:async()=>({data:{ok:false,code:'unauthenticated'},error:null})
  });}};
 });
 await page.route(/^https?:\/\//,route=>route.abort());
 await page.goto(pathToFileURL(path.join(__dirname,'..','configurar-coberturas.html')).href,
    {waitUntil:'domcontentloaded'});
 await page.locator('#session-help').waitFor({state:'visible'});
 assert.match(await page.locator('#notice').textContent(),/Ingresá como profesional/);
 assert.equal(await page.locator('#editor').isHidden(),true);
 assert.equal(await page.locator('#session-retry').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3));
 await page.close();
 console.log('PASS iPhone: sesión ausente muestra salida clara');
}
async function testHungSession(browser){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.addInitScript(()=>{
  window.supabase={createClient:(endpoint)=>{
   // Replica the SDK's real URL validation. A top-level `const URL`
   // in the page would shadow native URL and raise "Provided URL is malformed".
   try{
     const parsed=new URL(endpoint);
     if(parsed.protocol!=='https:'||parsed.hostname!=='mcqknmqhtmihegmifuka.supabase.co')
       throw Error('Unexpected Supabase host');
   }catch{throw Error('Invalid supabaseUrl: Provided URL is malformed.');}
   return ({
    auth:{getUser:()=>new Promise(()=>{})},
    rpc:async()=>({data:{ok:false},error:null})
  });}};
 });
 await page.route(/^https?:\/\//,route=>route.abort());
 await page.goto(pathToFileURL(path.join(__dirname,'..','configurar-coberturas.html')).href,
    {waitUntil:'domcontentloaded'});
 await page.locator('#session-help').waitFor({state:'visible',timeout:14000});
 assert.match(await page.locator('#notice').textContent(),/tardó demasiado/);
 assert.equal(await page.locator('#editor').isHidden(),true);
 await page.locator('#session-retry').click();
 assert.match(await page.locator('#notice').textContent(),/Comprobando tu sesión profesional/);
 await page.close();
 console.log('PASS iPhone: autenticación bloqueada no deja la página congelada');
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  await testBooking(browser,false);
  await testBooking(browser,true);
  await testAdmin(browser);
  await testNoSession(browser);
  await testHungSession(browser);
  await testSdkUnavailable(browser);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
