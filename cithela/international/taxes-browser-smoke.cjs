// Browser smoke for CITHELA USA Taxes: fake cases, local-only network.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=__dirname;
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  let file;
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  }catch{res.writeHead(400);res.end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
    res.end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [320,390,1280]){
      const page=await browser.newPage({viewport:{width,height:860}});
      const errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.route('**/*',route=>
        route.request().url().startsWith(origin)?route.continue():route.abort());
      await page.goto(origin+'/taxes-preview.html',{waitUntil:'load'});
      assert.equal(await page.locator('#case-list .case').count(),3);
      assert.equal(await page.locator('#metric-total').innerText(),'3');
      assert.equal(await page.locator('#metric-active').innerText(),'3');
      assert.equal(await page.locator('#metric-ready').innerText(),'1');
      assert.match(await page.locator('#guide-disclaimer').innerText(),/Do not upload/i);
      assert.equal(await page.locator('input[type=file]').count(),0);
      await page.locator('#case-list .case').nth(1).click();
      assert.equal(await page.locator('#case-ref').innerText(),'DEMO-B');
      await page.locator('#advance').click();
      assert.equal(await page.locator('#metric-ready').innerText(),'2');
      await page.locator('#mark-shared').click();
      assert.match(await page.locator('#guide-state').innerText(),/Shared/);
      await page.locator('#locale').selectOption('es');
      assert.match(await page.locator('#heading').innerText(),/declaraciones 2026/);
      assert.match(await page.locator('#guide-disclaimer').innerText(),/No subas/);
      assert.match(await page.locator('#reminder').innerText(),/Te recordamos tu turno/);
      assert.equal(await page.locator('html').getAttribute('lang'),'es');
      assert.ok(!(await page.locator('#advance').isDisabled()));
      await page.screenshot({
        path:path.join(process.cwd(),'cithela-taxes-'+width+'.png'),fullPage:true
      });
      const dims=await page.evaluate(()=>({
        width:innerWidth,scroll:document.documentElement.scrollWidth
      }));
      assert.ok(dims.scroll<=width+2,'horizontal scroll '+JSON.stringify(dims));
      assert.deepEqual(errors,[]);
      console.log('PASS Utah taxes, EN/ES, no uploads, demo stages, width '+width);
      await page.close();
    }
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});