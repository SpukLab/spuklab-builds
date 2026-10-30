import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.mjs':'application/javascript' };
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + sep)) throw Error('forbidden');
    if (statSync(target).isDirectory()) target = join(target, 'index.html');
    res.writeHead(200, {'Content-Type': mime[extname(target)] ?? 'application/octet-stream'});
    res.end(readFileSync(target));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const errors = [];
const cases = [
  {path:'/hub/', title:'SpukLab Hub'},
  {path:'/hub/productos/cithela/', title:'CITHELA'},
  {path:'/hub/productos/dahzea/', title:'DAHZEA'},
];
let browser;
try {
  browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  for (const viewport of [{width:375,height:812,label:'mobile-375'}, {width:1280,height:850,label:'desktop-1280'}]) {
    const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height}, deviceScaleFactor:1, reducedMotion:'reduce'});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    for (const site of cases) {
      const response = await page.goto(baseUrl + site.path, {waitUntil:'load'});
      assert.equal(response.status(), 200, 'HTTP failure on ' + site.path);
      assert.ok((await page.title()).includes(site.title), 'wrong title ' + site.path);
      const visibleH1 = await page.locator('h1').first().isVisible();
      assert.ok(visibleH1, 'h1 hidden on ' + site.path);
      const overflow = await page.evaluate(() => ({
        scroll:document.documentElement.scrollWidth,
        client:document.documentElement.clientWidth,
        x:window.scrollX
      }));
      console.log('RESPONSIVE', viewport.label, site.path, JSON.stringify(overflow));
      assert.ok(overflow.scroll <= overflow.client + 2, 'Horizontal overflow: ' + site.path + ' @ ' + viewport.label);
      if(site.path.includes('/dahzea/')) {
        await page.getByRole('tab', {name:'Paquetería'}).click();
        assert.ok(await page.locator('#demo-packing').isVisible(), 'Packing panel hidden');
        assert.equal(await page.locator('#demo-ventas').isVisible(), false, 'Sales should hide');
        await page.getByRole('tab', {name:'Postventa'}).click();
        assert.ok(await page.locator('#demo-postventa').isVisible(), 'Post-sale panel hidden');
        await page.getByRole('tab', {name:'Ventas'}).click();
        assert.ok(await page.locator('#demo-ventas').isVisible(), 'Sales panel hidden');
      }
      if(site.path === '/hub/') {
        const c=page.locator('a[href="productos/cithela/"]');
        const d=page.locator('a[href="productos/dahzea/"]');
        assert.ok(await c.isVisible() && await d.isVisible(),'Product links hidden');
      }
      if(site.path.includes('/cithela/')) {
        const btn=page.locator('a[href="../../../cithela/"]');
        assert.ok(await btn.isVisible(),'Professional access link hidden');
      }
      if(process.env.CAPTURE_HUB_INLINE_PREVIEW==='1' && viewport.width===375){
        const image = await page.screenshot({type:'jpeg',quality:36,fullPage:false});
        console.log('HUB_VISUAL_PREVIEW '+site.title.replace(/\\s+/g,'-')+' '+image.toString('base64'));
      }
      if(process.env.CAPTURE_HUB_SCREENSHOTS==='1'){
        const fs=await import('node:fs/promises');
        await fs.mkdir('hub/screenshots',{recursive:true});
        await page.screenshot({path:'hub/screenshots/'+site.title.toLowerCase().replace(/\W+/g,'-')+'-'+viewport.label+'.png', fullPage:true});
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, [], 'Page JS errors');
  console.log('PASS: Hub + CITHELA + DAHZEA, 375px and 1280px, links, DAHZEA tab interactions and JS errors');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((e) => e ? reject(e):resolve()));
}
