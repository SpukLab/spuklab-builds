// CITHELA EN/SMS smoke: local HTTP, synthetic phone, no messaging or external network.
const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,"..");
const types={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".png":"image/png",".svg":"image/svg+xml",".js":"text/javascript; charset=utf-8"};
const server=http.createServer((req,res)=>{
  let file;try{
    const url=new URL(req.url,"http://127.0.0.1");
    file=path.resolve(root,"."+decodeURIComponent(url.pathname));
    if(url.pathname==="/")file=path.join(root,"index.html");
  }catch{res.writeHead(400);res.end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);res.end();return;}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream"});
    res.end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [320,390,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});
      await page.route("**/*",route=>{
        if(route.request().url().startsWith(origin))return route.continue();
        return route.abort();
      });
      await page.goto(origin+"/index.html?lang=en&smsPreview=1",{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>window.CithelaSMS&&window.CithelaLocale,{timeout:10000});
      assert.equal(await page.locator("#rb-med").innerText(),"Professional");
      assert.equal(await page.locator("#professional-login-button").innerText(),"Sign in");
      assert.equal(await page.locator("#medico-tab-nuevo").innerText(),"+ Appointment");
      assert.equal(await page.locator("#medico-tab-config").innerText(),"Settings");
      assert.equal(await page.locator("#screen-patient-cloud .patient-refresh").innerText(),"Refresh my appointments");
      assert.equal(await page.locator("html").getAttribute("lang"),"en");
      await page.locator("#screen-login [data-cithela-language='es-AR']").click();
      assert.equal(await page.locator("#rb-med").innerText(),"Profesional");
      await page.locator("#screen-login [data-cithela-language='en-US']").click();
      assert.equal(await page.locator("#rb-med").innerText(),"Professional");
      assert.ok((await page.evaluate(()=>localStorage.getItem("cithela_ui_locale_v1")))==="en-US");
      // Appointment cards are rendered asynchronously after patient refreshes.
      await page.evaluate(()=>{
        document.getElementById("patient-cloud-list").innerHTML=
          '<section class="patient-workspace">'+
          '<button class="patient-booking-toggle">Reservar nuevo turno</button>'+
          '<div class="patient-appointment-actions"><button>Confirmar turno</button>'+
          '<button>Reprogramar</button></div>'+
          '<p class="sh">Próximos (2)</p><p class="sh">Historial (1)</p>'+
          '<p class="tenant-business-title">Sample Practice</p>'+
          '</section>';
      });
      await page.waitForFunction(()=>
        document.querySelector(".patient-booking-toggle")?.textContent==="Book an appointment");
      assert.equal(await page.locator(".patient-appointment-actions button").first().textContent(),"Confirm appointment");
      assert.equal(await page.locator(".patient-workspace .sh").first().textContent(),"Upcoming (2)");
      assert.equal(await page.locator(".patient-workspace .tenant-business-title").textContent(),"Sample Practice");
      await page.locator("#screen-login [data-cithela-language='es-AR']").click();
      assert.equal(await page.locator(".patient-booking-toggle").textContent(),"Reservar nuevo turno");
      assert.equal(await page.locator(".patient-workspace .sh").first().textContent(),"Próximos (2)");
      await page.locator("#screen-login [data-cithela-language='en-US']").click();
      const d=await page.evaluate(()=>window.CithelaSMS.openForPerson({
        phone:"+1 (415) 555-0132",clinic:"Sample Practice",
        accessUrl:"https://spuklab.github.io/spuklab-builds/cithela/",purpose:"access"
      }));
      assert.equal(d,true);
      await page.locator("#cithela-sms-dialog[open]").waitFor();
      assert.match(await page.locator("#cithela-sms-body").inputValue(),/Sample Practice/);
      assert.match(await page.locator("#cithela-sms-body").inputValue(),/lang=en/);
      assert.match(await page.locator("#cithela-sms-body").inputValue(),/Sign in/);
      await page.locator("#cithela-sms-copy").click();
      assert.match(await page.locator("#cithela-sms-error").innerText(),/Confirm consent/);
      assert.equal(await page.locator("#cithela-sms-consent").isChecked(),false);
      // La demostración de Taxes no aparece en la UI normal.
      const entry=page.locator("#cithela-utah-taxes-preview-entry");
      assert.equal(await entry.isVisible(),false);
      assert.equal(await entry.locator("a").getAttribute("href"),"./international/taxes-preview.html");
      await page.screenshot({path:path.join(process.cwd(),"cithela-en-sms-"+width+".png"),fullPage:true});
      await page.locator("#cithela-sms-close").click();
      await page.waitForFunction(()=>document.getElementById("cithela-sms-body").value==="");
      assert.equal(await page.locator("#cithela-sms-recipient").textContent(),"");
      // Aun con bandera QA, no habilitar el acceso profesional sin sesión cloud.
      await page.goto(origin+"/index.html?lang=en&taxesPreview=1",{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>window.CithelaSMS&&window.CithelaLocale,{timeout:10000});
      await page.evaluate(()=>updateCithelaTaxesPreviewEntry());
      assert.equal(await page.locator("#cithela-utah-taxes-preview-entry").isVisible(),false);
      const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dims.scroll<=width+2,"horizontal overflow "+width+": "+JSON.stringify(dims));
      console.log("PASS EN/ES switch, consent before SMS, neutral portal link, "+width+"px");
      await page.close();
    }
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
