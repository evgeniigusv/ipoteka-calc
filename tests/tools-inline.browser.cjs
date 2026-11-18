// node tests/tools-inline.browser.cjs [--live]
// По умолчанию оба сайта и API обслуживаются из файлов в памяти браузерного теста.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(require.resolve('playwright-core', {paths:[
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));

const root = path.resolve(__dirname,'..');
const partner = 'https://evgeniigusv.github.io/ipoteka-calc/';
const owner = 'http://127.0.0.1:8795/';
const live = process.argv.includes('--live');
async function check(browser, width, entry = partner) {
  const context = await browser.newContext({viewport:{width,height:width===390?844:960}});
  try {
    await context.grantPermissions(['local-network-access'], {origin:new URL(partner).origin});
    const catalog = JSON.parse(fs.readFileSync(path.join(root,'assets/tools.json')));
    const privateName = 'Проверка закрытой записи';
    const example = catalog.records.find(r=>r.enabled && r.kind==='info' && r.category==='installment' && r.project==='da1');
    const personal = {...example, id:'qa-private', group:'qa-private', name:privateName, params:{...example.params,ownerOnly:true}};
    let deny = !live && width===1280 && entry===partner, sessions = 0;
    const errors = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') {
        errors.push('Неожиданный запрос '+request.method()+' '+url.pathname);
        return route.abort();
      }
      if (live) return route.continue();
      if (request.url().startsWith(owner+'api/')) {
        if (url.pathname==='/api/session') { sessions++; return route.fulfill({json:{csrf:'synthetic-test-session'}}); }
        if (url.pathname==='/api/settings') return route.fulfill({json:{settings:catalog.settings,revision:'qa'}});
        if (url.pathname==='/api/tools') {
          assert.equal(request.headers()['x-editor-session'],'synthetic-test-session');
          if (deny) return route.fulfill({status:401,json:{}});
          return route.fulfill({json:{...catalog,revision:'qa',records:[...catalog.records,personal]}});
        }
      }
      const base = [partner,owner].find(base=>request.url().startsWith(base));
      if (!base) return route.abort();
      const file = path.join(root,decodeURIComponent(url.pathname.slice(new URL(base).pathname.length)));
      return route.fulfill({path:file});
    });
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',msg=>{
      if (msg.type()==='error' && !(deny && msg.text().includes('401'))) errors.push(msg.text());
    });
    await page.goto(entry+'tools.html?theme=sm&project=da1&section=installment');
    assert.match(await page.title(),/Инструменты/);
    const startUrl = page.url();
    const edit = page.locator('#tools-owner-link');
    await page.locator('.tool-entry').first().waitFor();
    await page.locator('#tools-search').fill('рассроч');
    const placement = await page.locator('.tools-view-tabs').boundingBox();
    await edit.click();
    if (deny) {
      await page.locator('#owner-recovery').waitFor();
      assert.match(await page.locator('#owner-progress').innerText(),/401/);
      deny=false;
      await page.locator('#owner-retry').click();
    }
    const frame = page.frameLocator('#owner-window iframe');
    await frame.locator('.tool-record-edit').first().waitFor({timeout:60000});
    assert.equal(page.url(), startUrl);
    assert.equal(context.pages().length,1);
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#public-catalog').isVisible(),false);
    assert.equal(await frame.locator('.tools-mast').isVisible(),false);
    assert.equal(await frame.locator('#tools-category').inputValue(),'installment');
    assert.equal(await frame.locator('#tools-search').inputValue(),'рассроч');
    assert.equal(await frame.locator('[data-project=da1]').getAttribute('aria-pressed'),'true');
    const actual = await frame.locator('.tools-view-tabs').boundingBox();
    for (const key of ['x','y','width']) assert.ok(Math.abs(actual[key]-placement[key])<=1,
      'Положение '+key+' в просмотре '+placement[key]+', в редакторе '+actual[key]);
    const sessionFrame = page.frames().find(f=>f.parentFrame()===page.mainFrame() && f.url().startsWith(owner));
    assert.equal(await sessionFrame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if (!live && entry===partner) await page.screenshot({path:path.join(os.tmpdir(),'tools-inline-'+width+'.png')});
    const record = frame.locator('.tool-entry').first();
    await record.locator('[data-edit]').click();
    await frame.locator('#tools-editor[open]').waitFor();
    await frame.locator('#tools-cancel').click();
    await record.locator('summary').click();
    await record.locator('[data-toggle]').click(); // Только черновик в памяти.
    assert.match(await frame.locator('#tools-change-count').innerText(),/черновике: 1/);
    await frame.locator('#tools-search').fill(live?'':privateName);
    if (!live) await frame.locator('[data-record="qa-private"]').waitFor();
    await page.locator('[data-theme-choice=classic]').click();
    await frame.locator('html[data-theme=classic]').waitFor();
    await frame.locator('#owner-return').click();
    await edit.waitFor();
    assert.equal(await page.locator('#tools-search').inputValue(),'рассроч');
    assert.equal(await page.locator('.tools-private').count(),0);
    assert.equal(await page.locator('body').innerText().then(t=>t.includes(privateName)),false);
    await edit.click();
    await frame.locator('#owner-return').waitFor();
    assert.equal(await frame.locator('#tools-search').inputValue(),live?'':privateName);
    assert.equal(await frame.locator('#tools-change-count').innerText().then(t=>t.includes('черновике: 1')),true);
    assert.equal(sessionFrame,page.frames().find(f=>f.parentFrame()===page.mainFrame() && f.url().startsWith(owner)));
    if (!live) assert.equal(sessions,width===1280 && entry===partner?2:1);
    assert.deepEqual(errors,[]);
    console.log(new URL(entry).hostname+' · '+width+' px — вход, фильтры, форма, черновик, тема и возврат проверены.');
  } finally { await context.close(); }
}
(async()=>{
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_BIN});
  try {
    for (const width of [1280,390]) await check(browser,width);
    if (!live) await check(browser,1280,owner);
  }
  finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
