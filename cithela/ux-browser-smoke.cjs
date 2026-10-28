// CITHELA layout smoke checks: Chromium device-size emulation (not Safari/iOS).
// No Supabase mutations, no real credentials, no network requests.
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('http**/*', route => route.abort());
      await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href, { waitUntil: 'domcontentloaded' });
      // The branded landing is always CITHELA teal, even when a tenant uses clay.
      const colors = await page.evaluate(() => {
        applyCithelaTheme('clay');
        const landing = getComputedStyle(document.getElementById('screen-login'));
        const workspace = getComputedStyle(document.getElementById('screen-medico'));
        return {
          loginAccent: landing.getPropertyValue('--teal').trim(),
          workspaceAccent: workspace.getPropertyValue('--teal').trim(),
          loginTitle: document.getElementById('login-brand').textContent.trim(),
          loginAction: getComputedStyle(document.getElementById('professional-login-button')).backgroundColor
        };
      });
      assert.deepEqual(colors, {
        loginAccent:'#2f7d73', workspaceAccent:'#84472f', loginTitle:'CITHELA',
        loginAction:'rgb(47, 125, 115)'
      }, 'tenant palette must not recolor login at '+width);
      await page.evaluate(() => {
        document.getElementById('screen-login').classList.remove('active');
        document.getElementById('screen-medico').classList.add('active');
        // Keep this smoke check independent from an authenticated cloud tenant.
        for (const [label, pane] of [['agenda','p-medico-agenda'],['pacientes','p-medico-pacientes']])
          if (!document.getElementById(pane)) throw Error('Missing ' + label + ' pane');
      });
      const geometry = await page.evaluate(() => {
        const r = document.querySelector('#screen-medico').getBoundingClientRect();
        const next = document.querySelector('.wn-btn').getBoundingClientRect();
        const agenda = document.getElementById('p-medico-agenda');
        const list = document.getElementById('agenda-list').getBoundingClientRect();
        const stats = document.getElementById('stats').getBoundingClientRect();
        const nav = document.getElementById('professional-tabs');
        return { screenWidth:r.width, pageWidth:document.documentElement.scrollWidth,
                 windowWidth:window.innerWidth, prevDayWidth:next.width, prevDayHeight:next.height,
                 statsAfterList:stats.top >= list.top, navScrollWidth:nav.scrollWidth,
                 navClientWidth:nav.clientWidth,
                 hasMessages:!!document.getElementById('cloud-wa-tab') };
      });
      assert.ok(geometry.screenWidth <= width+2, 'screen overflow at '+width);
      assert.ok(geometry.pageWidth <= width+2, 'document overflow at '+width+': '+JSON.stringify(geometry));
      assert.ok(geometry.prevDayWidth >= 44 && geometry.prevDayHeight >= 44,
        'calendar arrows too small at '+width);
      assert.ok(geometry.statsAfterList, 'weekly stats should follow agenda tasks');
      assert.ok(geometry.hasMessages, 'WhatsApp Messages navigation must survive UX merge');
      // Exercise the real tab handler and the reports round trip (no data writes).
      await page.locator('#medico-tab-config').click();
      assert.equal(await page.locator('#p-medico-config').evaluate(el => el.classList.contains('on')), true,
        'Ajustes tab did not open at '+width);
      await page.locator('.settings-report-link').click();
      assert.equal(await page.locator('#p-medico-reportes').evaluate(el => el.classList.contains('on')), true,
        'Reportes link did not open at '+width);
      await page.locator('.report-back').click();
      assert.equal(await page.locator('#p-medico-config').evaluate(el => el.classList.contains('on')), true,
        'Reports back navigation did not return to Ajustes at '+width);
      await page.locator('#medico-tab-agenda').click();
      assert.equal(await page.locator('#p-medico-agenda').evaluate(el => el.classList.contains('on')), true,
        'Return to Agenda failed at '+width);
      console.log('PASS tab navigation '+width+'px');
      // Test a long tenant name with a logo locally; no Supabase session or upload.
      const identity = await page.evaluate(() => {
        const name = document.getElementById('professional-business-name');
        const brand = document.getElementById('professional-brand');
        const image = document.getElementById('professional-tenant-logo');
        name.textContent = 'Estudio de atención y tratamientos profesionales del barrio';
        brand.classList.add('has-tenant-logo');
        image.style.display = 'block';
        image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%232f7d73"/%3E%3C/svg%3E';
        const imageRect = image.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        const exitRect = document.querySelector('#screen-medico .nav-out').getBoundingClientRect();
        return {
          logoWidth:imageRect.width, logoHeight:imageRect.height,
          nameBeforeExit:nameRect.right<=exitRect.left+1,
          iconHidden:getComputedStyle(brand,'::before').display==='none',
          screenWidth:document.documentElement.scrollWidth,
          title:name.getAttribute('title')
        };
      });
      assert.ok(identity.logoWidth>=46&&identity.logoHeight>=46,
        'Tenant logo too small at '+width+': '+JSON.stringify(identity));
      assert.ok(identity.nameBeforeExit&&identity.iconHidden&&identity.screenWidth<=width+2,
        'Long tenant branding overflow or duplicate CITHELA symbol at '+width+': '+JSON.stringify(identity));
      console.log('PASS establishment branding '+width+'px');
      // Generate a synthetic oversized photo entirely in-browser, with no upload.
      if(width===390){
        const prepared=await page.evaluate(async()=>{
          const canvas=document.createElement('canvas');
          canvas.width=1024;canvas.height=840;
          const context=canvas.getContext('2d'),pix=context.createImageData(canvas.width,canvas.height);
          let seed=2018;
          for(let i=0;i<pix.data.length;i+=4){
            seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
            pix.data[i]=seed&255;pix.data[i+1]=(seed>>>8)&255;
            pix.data[i+2]=(seed>>>16)&255;pix.data[i+3]=255;
          }
          context.putImageData(pix,0,0);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
          const input=new File([blob],'foto-iphone.png',{type:'image/png'});
          const output=await prepareCloudBrandImage(input);
          const magic=Array.from(new Uint8Array(await output.slice(0,3).arrayBuffer()));
          return {original:input.size,compressed:output.size,type:output.type,magic};
        });
        assert.ok(prepared.original>524288,'synthetic original should exceed logo limit');
        assert.ok(prepared.compressed<=524288&&prepared.compressed>0,
          'logo preparation should fit 512 KB: '+JSON.stringify(prepared));
        assert.equal(prepared.type,'image/jpeg');
        assert.deepEqual(prepared.magic,[255,216,255],'compressed image must be valid JPEG');
        console.log('PASS iPhone-size photo conversion '+JSON.stringify(prepared));
      }
      // Visual snapshot for human review in Actions artifacts, without patient details.
      await page.screenshot({ path: path.join(process.cwd(), 'cithela-layout-'+width+'.png'), fullPage: true });
      console.log('PASS layout '+width+'px '+JSON.stringify(geometry));
      if (errors.length) console.log('INFO page startup warnings at '+width+': '+errors.slice(0,3).join(' | '));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exit(1); });
