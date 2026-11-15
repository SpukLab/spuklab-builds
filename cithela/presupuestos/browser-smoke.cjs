// CITHELA Presupuestos: navegador real, backend completamente simulado.
// No consulta a Supabase, no crea pacientes, no envía WhatsApp.
const fs=require("node:fs");
const path=require("node:path");
const http=require("node:http");
const assert=require("node:assert/strict");
const {chromium}=require("playwright");

const base=path.resolve(__dirname,"..");
const mime={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
".js":"text/javascript; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",
".css":"text/css; charset=utf-8"};
function server(){
  return http.createServer((req,res)=>{
    const url=new URL(req.url,"http://127.0.0.1");
    const target=path.resolve(base,"."+decodeURIComponent(url.pathname));
    if(!target.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(target,(err,buffer)=>{
      if(err){res.writeHead(404);res.end("Not found");return;}
      res.writeHead(200,{"Content-Type":mime[path.extname(target)]||"application/octet-stream"});
      res.end(buffer);
    });
  });
}
async function installMock(page){
  await page.addInitScript(()=>{
    const tenant="a1000000-0000-4000-8000-000000000001";
    const patients=[{id:"b1000000-0000-4000-8000-000000000001",tenant_id:tenant,display_name:"Paciente Ficticio A"},
                    {id:"b2000000-0000-4000-8000-000000000002",tenant_id:tenant,display_name:"Paciente Ficticio B"}];
    const catalog=[{id:"cat-demo-1",service_id:null,name:"Limpieza de ejemplo",unit_minor:3500000,currency:"ARS",active:true,updated_at:"2026-11-15T12:00:00Z"}];
    const saved=[];
    let versions=0;
    const now=()=>new Date(Date.UTC(2026,10,15,12,0,versions++)).toISOString();
    class Query{
      constructor(table){this.table=table;this.conditions=[];this.onlyOne=false;this.cap=Infinity;}
      select(){return this;}
      eq(field,value){this.conditions.push([field,value]);return this;}
      order(){return this;}
      limit(n){this.cap=n;return this;}
      single(){this.onlyOne=true;return this;}
      then(resolve,reject){
        const rows={cithela_tenant_memberships:[{tenant_id:tenant,role:"owner",created_at:"2026-11-15T00:00:00Z"}],
          cithela_tenants:[{id:tenant,display_name:"Consultorio Ficticio",status:"active"}],
          cithela_people:patients,
          cithela_services:[{id:"service-demo-1",tenant_id:tenant,name:"Limpieza de ejemplo",active:true}]
        }[this.table]||[];
        const results=rows.filter(row=>this.conditions.every(([field,value])=>row[field]===value)).slice(0,this.cap);
        return Promise.resolve({data:this.onlyOne?(results[0]||null):results,error:null}).then(resolve,reject);
      }
    }
    const api={
      auth:{
        getSession:async()=>({data:{session:{user:{id:"staff-demo"}}},error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
      },
      from:table=>new Query(table),
      rpc:async(name,{p_tenant_id,p_command,p_payload})=>{
        if(name!=="cithela_quote_command"||p_tenant_id!==tenant)return {data:{ok:false,code:"forbidden"},error:null};
        switch(p_command){
          case "catalog.list":return {data:{ok:true,catalog},error:null};
          case "quote.list":return {data:{ok:true,quotes:saved
            .filter(x=>!p_payload.person_id||x.person_id===p_payload.person_id)
            .slice().reverse()},error:null};
          case "quote.save":{
            const subtotal=p_payload.items.reduce((sum,x)=>sum+x.unit_minor*x.quantity,0);
            const total=subtotal-p_payload.discount_minor;
            let quote=p_payload.id?saved.find(x=>x.id===p_payload.id):null;
            if(!quote){
              quote={id:"c1000000-0000-4000-8000-000000000001",
                reference:"P-DEMO-0001",created_at:now(),status:"borrador"};
              saved.push(quote);
            }
            Object.assign(quote,{person_id:p_payload.person_id,items:p_payload.items.map(x=>({...x,total_minor:x.unit_minor*x.quantity})),
              subtotal_minor:subtotal,discount_minor:p_payload.discount_minor,total_minor:total,
              validity_days:p_payload.validity_days,updated_at:now(),currency:"ARS"});
            return {data:{ok:true,code:"saved",id:quote.id,reference:quote.reference,
                status:quote.status,updated_at:quote.updated_at,total_minor:total},error:null};
          }
          case "quote.status":{
            const quote=saved.find(q=>q.id===p_payload.id);
            if(!quote)return {data:{ok:false,code:"not_found"},error:null};
            quote.status=p_payload.status;quote.updated_at=now();
            return {data:{ok:true,code:"status_updated",id:quote.id,status:quote.status,updated_at:quote.updated_at},error:null};
          }
          case "catalog.upsert":{
            const item={id:"cat-demo-2",name:p_payload.name,unit_minor:p_payload.unit_minor,
              currency:"ARS",active:true,updated_at:now()};
            catalog.push(item);
            return {data:{ok:true,catalog_item:item},error:null};
          }
          default:return {data:{ok:false,code:"unsupported_command"},error:null};
        }
      }
    };
    window.supabase={createClient:()=>api};
  });
}
async function main(){
  const httpServer=server();
  await new Promise(resolve=>httpServer.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+httpServer.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [320,390,768,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.route("**/*",route=>{
        if(route.request().url().startsWith(origin))return route.continue();
        return route.abort();
      });
      await installMock(page);
      await page.goto(origin+"/presupuestos/cloud.html#person=b1000000-0000-4000-8000-000000000001",
        {waitUntil:"domcontentloaded"});
      await page.locator("#workspace:visible").waitFor({timeout:15000});
      await page.waitForFunction(()=>
        document.getElementById("patient")?.value==="b1000000-0000-4000-8000-000000000001",
        null,{timeout:7000}).catch(async error=>{
          console.log("QA patient preselection diagnostics",await page.evaluate(()=>({
            hash:location.hash,
            selected:document.getElementById("patient")?.value,
            options:[...document.querySelectorAll("#patient option")].map(x=>({value:x.value,label:x.textContent})),
            startup:document.getElementById("bootstrap-message")?.textContent,
            feedback:document.getElementById("feedback")?.textContent
          })));
          throw error;
        });
      assert.equal(await page.locator("#patient").inputValue(),"b1000000-0000-4000-8000-000000000001");
      await page.locator("#catalog-select").selectOption("cat-demo-1");
      await page.locator("#line-quantity").fill("2");
      await page.locator("#add-line").click();
      await page.locator("#discount").fill("500");
      assert.match(await page.locator("#total").innerText(),/69\.500/);
      await page.locator("#save-quote").click();
      await page.waitForFunction(()=>document.getElementById("reference").value==="P-DEMO-0001");
      assert.equal(await page.locator("#print-quote").isEnabled(),true);
      await page.locator("#prepare-share").click();
      await page.locator("#share-dialog[open]").waitFor();
      assert.match(await page.locator("#share-text").inputValue(),/Paciente Ficticio A/);
      await page.locator("#close-share").click();
      page.once("dialog",dialog=>dialog.accept());
      await page.locator("#mark-sent").click();
      await page.waitForFunction(()=>document.getElementById("quote-status").textContent==="Enviado");
      assert.equal(await page.locator("#add-line").isDisabled(),true);
      const viewport=await page.evaluate(()=>({
        viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth
      }));
      assert.ok(viewport.scrollWidth<=width+2,
        "Horizontal overflow at "+width+": "+JSON.stringify(viewport));
      assert.deepEqual(errors,[], "Runtime errors at "+width);
      await page.screenshot({path:path.join(process.cwd(),"cithela-quotes-layout-"+width+".png"),fullPage:true});
      console.log("PASS quote create/save/WhatsApp/status & layout "+width+"px");
      await page.close();
    }
  }finally{
    await browser.close();
    await new Promise(resolve=>httpServer.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
