// CITHELA availability range smoke. Entirely local, synthetic and no cloud requests.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  let file;
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if(u.pathname==='/')file=path.join(root,'index.html');
  }catch{res.writeHead(400);res.end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,body)=>{
    if(err){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});
    res.end(body);
  });
});
(async()=>{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [320,390,768,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('dialog',async dialog=>dialog.accept());
      await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      await page.goto(origin+'/index.html?demo=1',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof syncAvailabilityBlockMode==='function'&&window.CithelaBlockRanges);
      await page.evaluate(()=>{
        document.getElementById('screen-login').classList.remove('active');
        document.getElementById('screen-medico').classList.add('active');
        document.getElementById('p-medico-config').classList.add('on');
        document.getElementById('cfg-section-availability').open=true;
        document.getElementById('cfg-block-modo').value='single';
        syncAvailabilityBlockMode();
      });
      assert.equal(await page.locator('#cfg-block-single').isVisible(),true);
      assert.equal(await page.locator('#cfg-block-range').isVisible(),false);
      await page.locator('#cfg-block-modo').selectOption('range');
      assert.equal(await page.locator('#cfg-block-single').isVisible(),false);
      assert.equal(await page.locator('#cfg-block-range').isVisible(),true);
      assert.match(await page.locator('#cfg-block-save').innerText(),/Bloquear período/);
      await page.locator('#cfg-block-desde').fill('2026-12-24');
      await page.locator('#cfg-block-hasta').fill('2027-01-04');
      await page.locator('#cfg-block-motivo').fill('Vacaciones de prueba');
      // In local demo mode, only synthetic records are generated.
      await page.locator('#cfg-block-save').click();
      assert.match(await page.locator('#cfg-block-range-status').innerText(),/12 días/);
      assert.equal(await page.locator('#cfg-block-list .block-row').count(),12);
      await page.screenshot({path:path.join(process.cwd(),'cithela-vacaciones-'+width+'.png'),fullPage:true});
      const dimensions=await page.evaluate(()=>({
        viewport:window.innerWidth,
        scroll:document.documentElement.scrollWidth
      }));
      assert.ok(dimensions.scroll<=width+2,'horizontal overflow at '+width+': '+JSON.stringify(dimensions));
      assert.deepEqual(errors,[]);
      console.log('PASS: date range 24 Dec–4 Jan, responsive width '+width);
      await page.close();
    }
  }finally{
    await browser.close();
    await new Promise(done=>server.close(done));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});