// CITHELA Utah demo: public website availability smoke, synthetic site only.
const https=require('node:https');
const assert=require('node:assert/strict');
const root='https://cithela-usa-taxes-demo.vercel.app';
async function get(path){
  return new Promise((resolve,reject)=>{
    const req=https.get(root+path,{timeout:15000,headers:{'User-Agent':'CITHELA-demo-healthcheck/1.0'}},res=>{
      const parts=[];
      res.on('data',x=>parts.push(x));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));
    req.on('error',reject);
  });
}
(async()=>{
  const [html,view,model,services]=await Promise.all([
    get('/'),get('/taxes-preview.mjs'),get('/taxes-workflow.mjs'),get('/utah-services.mjs')
  ]);
  for(const [label,item] of Object.entries({html,view,model,services})){
    assert.equal(item.status,200,label+' must load without authentication');
    assert.doesNotMatch(item.body,/vercel authentication|log in to vercel|deployment protection|not found/i,label+' should be public');
  }
  assert.match(html.body,/<title>CITHELA · USA Taxes/);
  assert.match(html.body,/No tax files, tax amounts or taxpayer details are collected/);
  assert.match(view.body,/createDemoTaxCase/);
  assert.match(model.body,/unapproved_field/);
  assert.match(services.body,/UTAH_SERVICE_PRESETS/);
  console.log('PASS: demo root and 3 modules load publicly with no login or private data');
})().catch(e=>{console.error(e);process.exitCode=1;});