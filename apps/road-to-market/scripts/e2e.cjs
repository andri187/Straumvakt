const puppeteer = require('E:/Claude/Straumvakt-connected-test/node_modules/puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.E2E_BASE || 'http://localhost:8799';
const PW = 'Straumvakt-Test-2026!';
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function login(page, email){
  await page.goto(BASE+'/', {waitUntil:'networkidle2'});
  await page.waitForSelector('#rtm-login', {timeout:15000});
  await page.type('#rtm-email', email); await page.type('#rtm-pass', PW);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle2'}).catch(()=>{}), page.click('#rtm-login button[type=submit]')]);
  await page.waitForSelector('#rtm-banner', {timeout:15000});
}
(async()=>{
  const browser = await puppeteer.launch({executablePath:CHROME, headless:'new', args:['--no-sandbox']});
  const results = {};
  try {
    // ---- ADMIN ----
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push('console:'+m.text());});
    await login(page, 'admin@straumvakt-test.is');
    results.admin_banner = (await page.$eval('#rtm-banner', el=>el.innerText)).slice(0,90);
    // organisations screen
    await page.goto(BASE+'/#/admin/organisations', {waitUntil:'networkidle2'}); await sleep(400);
    const orgText = await page.$eval('#main', el=>el.innerText);
    results.admin_sees_orgA = /Nor.?urorka Test/.test(orgText);
    results.admin_sees_orgB = /Vestan Test/.test(orgText);
    // sessions screen shows real drivers
    await page.goto(BASE+'/#/admin/sessions', {waitUntil:'networkidle2'}); await sleep(400);
    const sesText = await page.$eval('#main', el=>el.innerText);
    results.admin_sessions_have_driver = /Anna Driver|Bj.rn Driver|Cara Driver/.test(sesText);
    // write blocked: click "New organisation" -> expect toast, no modal
    await page.goto(BASE+'/#/admin/organisations', {waitUntil:'networkidle2'}); await sleep(300);
    const newBtn = await page.$('[data-action="new-org"]');
    if(newBtn){ await newBtn.click(); await sleep(300);
      const modalOpen = await page.evaluate(()=>{const m=document.getElementById('modal'); return !!(m&&m.open);});
      const toast = await page.evaluate(()=>{const t=document.getElementById('toast'); return t?t.innerText:'';});
      results.write_blocked = (!modalOpen) && /read-only/i.test(toast);
    } else results.write_blocked='no-new-btn';
    await page.screenshot({path: process.env.SP+'/e2e-admin-overview.png'});
    results.admin_js_errors = errors.slice(0,5);
    await page.close();

    // ---- CPO host A (isolation) ----
    const ctx = await browser.createBrowserContext();
    const p2 = await ctx.newPage(); const e2=[]; p2.on('pageerror',e=>e2.push(String(e)));
    await login(p2, 'host@nordurorka-test.is');
    results.cpo_banner = (await p2.$eval('#rtm-banner', el=>el.innerText)).slice(0,90);
    await p2.goto(BASE+'/#/cpo/sites', {waitUntil:'networkidle2'}); await sleep(400);
    const cpoText = await p2.$eval('#main', el=>el.innerText);
    results.cpo_sees_ownA = /Nor.?urorka Test Main Site/.test(cpoText);
    results.cpo_NOT_sees_B = !/Vestan/.test(cpoText);
    results.cpo_js_errors = e2.slice(0,5);
    await ctx.close();
  } catch(e){ results.FATAL = String(e); }
  await browser.close();
  console.log(JSON.stringify(results,null,2));
})();
