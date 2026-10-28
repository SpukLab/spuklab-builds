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
      // Visual snapshot for human review in Actions artifacts, without patient details.
      await page.screenshot({ path: path.join(process.cwd(), 'cithela-layout-'+width+'.png'), fullPage: true });
      console.log('PASS layout '+width+'px '+JSON.stringify(geometry));
      if (errors.length) console.log('INFO page startup warnings at '+width+': '+errors.slice(0,3).join(' | '));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exit(1); });
