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
  const keyboard = entry === owner;
  const reduced = width === 390;
  const context = await browser.newContext({
    viewport:{width,height:reduced?844:960}, hasTouch:width === 390,
    reducedMotion:reduced?'reduce':'no-preference'
  });
  function activate(button, byKey = keyboard) {
    if (byKey) return button.press('Enter');
    return width === 390 ? button.tap() : button.click();
  }
  const animation = element => element.evaluate(node=>getComputedStyle(node).animationName);
  const focused = element => element.evaluate(node=>node === document.activeElement);
  const expectedMotion = name => keyboard || reduced ? 'none' : name;
  try {
    await context.grantPermissions(['local-network-access'], {origin:new URL(partner).origin});
    const catalog = JSON.parse(fs.readFileSync(path.join(root,'assets/tools.json')));
    const privateName = 'Проверка закрытой записи';
    const example = catalog.records.find(r=>r.enabled && r.kind==='info' && r.category==='installment' && r.project==='da1');
    const personal = {...example, id:'qa-private', group:'qa-private', name:privateName, combination:'', params:{...example.params,ownerOnly:true}};
    let deny = !live && width===1280 && entry===partner, sessions = 0;
    const changeDuringLoad = !live && width === 390 && entry === partner;
    let releaseCatalog;
    const catalogGate = changeDuringLoad ? new Promise(resolve => { releaseCatalog = resolve; }) : Promise.resolve();
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
          await catalogGate;
          assert.equal(request.headers()['x-editor-session'],'synthetic-test-session');
          if (deny) return route.fulfill({status:401,json:{}});
          return route.fulfill({json:{...catalog,revision:'qa',records:[...catalog.records,personal]}});
        }
      }
      const base = [partner,owner].find(base=>request.url().startsWith(base));
      if (!base) return route.abort();
      const file = path.join(root,decodeURIComponent(url.pathname.slice(new URL(base).pathname.length)) || 'index.html');
      return route.fulfill({path:file});
    });
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',msg=>{
      if (msg.type()==='error' && !(deny && msg.text().includes('401'))) errors.push(msg.text());
    });
    await page.goto(entry+'tools.html?theme=dark&project=da1&section=installment');
    assert.match(await page.title(),/Инструменты/);
    const startUrl = page.url();
    const edit = page.locator('#tools-owner-link');
    await page.locator('.tool-entry').first().waitFor();
    await page.locator('#tools-search').fill('рассроч');
    const placement = await page.locator('.tools-view-tabs').boundingBox();
    await activate(edit);
    if (deny) {
      await page.locator('#owner-recovery').waitFor();
      assert.match(await page.locator('#owner-progress').innerText(),/401/);
      assert.ok(await focused(page.locator('#owner-cancel')));
      deny=false;
      await page.locator('#owner-retry').click();
    }
    const frame = page.frameLocator('#owner-window iframe');
    if (changeDuringLoad) {
      await frame.locator('html[data-theme=dark]').waitFor({state:'attached'});
      await page.locator('[data-theme-choice=light]').click();
      assert.equal(await page.locator('#owner-window iframe').isVisible(), false);
      releaseCatalog();
    }
    await frame.locator('.tool-record-edit').first().waitFor({timeout:60000});
    const expectedUrl = new URL(startUrl);
    if (changeDuringLoad) expectedUrl.searchParams.set('theme','light');
    assert.equal(page.url(), expectedUrl.href);
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
    assert.equal(await frame.locator('html').getAttribute('data-theme'), changeDuringLoad ? 'light' : 'dark');
    const sessionFrame = page.frames().find(f=>f.parentFrame()===page.mainFrame() && f.url().startsWith(owner));
    assert.equal(await sessionFrame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if (!live && entry===partner) await page.screenshot({path:path.join(os.tmpdir(),'tools-inline-'+width+'.png')});
    const record = frame.locator('.tool-entry').first();
    const editRecord = record.locator('[data-edit]');
    const dialog = frame.locator('#tools-editor');
    assert.ok(await focused(frame.locator('#owner-return')));
    if (!live) assert.equal(await animation(page.locator('#owner-window iframe')),expectedMotion('tools-mode-entry'));

    // Проверяем форму в том же событии, в котором нажали кнопку правки.
    await sessionFrame.evaluate(() => document.addEventListener('click', event => {
      if (!event.target.closest('[data-edit]')) return;
      const dialog = document.getElementById('tools-editor');
      window.formOpenedOnClick = dialog.open && dialog.contains(document.activeElement) &&
        !!dialog.querySelector('[name=name]').value;
    }, {once:true}));
    await activate(editRecord);
    assert.ok(await sessionFrame.evaluate(()=>window.formOpenedOnClick));
    if (!live) assert.equal(await animation(dialog),expectedMotion('tools-form-entry'));
    const name = dialog.locator('[name=name]');
    await name.fill('Несохранённый текст формы');
    const nextTheme = changeDuringLoad ? 'dark' : 'light';
    await page.locator('[data-theme-choice=' + nextTheme + ']').click();
    await frame.locator('html[data-theme=' + nextTheme + ']').waitFor();
    assert.equal(new URL(await page.locator('#owner-direct').getAttribute('href')).searchParams.get('theme'), nextTheme);
    assert.equal(await name.inputValue(),'Несохранённый текст формы');
    await dialog.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.ok(await focused(editRecord));

    const add = frame.locator('#tools-add'), ai = frame.locator('#tools-ai');
    await activate(add, true);
    assert.ok(await dialog.isVisible());
    if (!live) assert.equal(await animation(dialog),'none');
    await frame.locator('#tools-cancel').click();
    assert.ok(await focused(add));
    await activate(ai);
    const suggestions = frame.locator('#ai-dialog');
    assert.ok(await suggestions.isVisible());
    if (!live) assert.equal(await animation(suggestions),expectedMotion('tools-form-entry'));
    await suggestions.press('Escape');
    assert.ok(await focused(ai));
    await record.locator('summary').click();
    await record.locator('[data-toggle]').click(); // Только черновик в памяти.
    assert.match(await frame.locator('#tools-change-count').innerText(),/черновике: 1/);
    await frame.locator('#tools-search').fill(live?'':privateName);
    if (!live) {
      const privateEdit = frame.locator('[data-edit="qa-private"]');
      await activate(privateEdit);
      await dialog.locator('.tools-form-more > summary').click();
      await dialog.locator('[name=validUntil]').fill('2030-12-31');
      await dialog.locator('[type=submit]').click();
      await dialog.waitFor({state:'hidden'});
      await privateEdit.and(frame.locator(':focus')).waitFor({timeout:2000});
    }
    await activate(frame.locator('#owner-return'));
    await edit.waitFor();
    assert.ok(await focused(edit));
    if (!live) assert.equal(await animation(page.locator('#public-catalog')),expectedMotion('tools-mode-entry'));
    assert.equal(await page.locator('#tools-search').inputValue(),'рассроч');
    assert.equal(await page.locator('.tools-private').count(),0);
    assert.equal(await page.locator('body').innerText().then(t=>t.includes(privateName)),false);
    await activate(edit, true);
    await frame.locator('#owner-return').waitFor();
    if (!live) assert.equal(await animation(page.locator('#owner-window iframe')),'none');
    assert.equal(await frame.locator('#tools-search').inputValue(),live?'':privateName);
    assert.match(await frame.locator('#tools-change-count').innerText(),live?/черновике: 1/:/черновике: 2/);
    assert.equal(sessionFrame,page.frames().find(f=>f.parentFrame()===page.mainFrame() && f.url().startsWith(owner)));
    if (!live) assert.equal(sessions,width===1280 && entry===partner?2:1);
    await frame.locator('#owner-return').press('Escape');
    await edit.waitFor();
    assert.ok(await focused(edit));
    if (!live) assert.equal(await animation(page.locator('#public-catalog')),'none');
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
