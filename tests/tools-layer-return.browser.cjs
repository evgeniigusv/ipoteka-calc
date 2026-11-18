// Запускается из файлов проекта, сеть и сохранение изменений отключены.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(require.resolve('playwright-core', {paths:[
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const root = path.resolve(__dirname, '..');
const catalog = require('../assets/tools.json');
const origin = 'http://127.0.0.1:8795';

async function check(browser, reducedMotion) {
  const page = await browser.newPage({reducedMotion});
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/ai/propose' && route.request().method() === 'POST') {
        const record = catalog.records.find(r=>r.kind==='info' && r.enabled);
        return route.fulfill({json:{revision:'test',questions:[],items:[
          {action:'Добавление',record,ticket:'test',quotes:['Проверка перехода']}
        ]}});
      }
      if (url.pathname === '/api/events/tools-changed' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        assert.equal(body.preview,true);
        return route.fulfill({json:{changes:body.changes}});
      }
      if (route.request().method() !== 'GET') return route.abort();
      if (url.pathname === '/api/session') return route.fulfill({json:{csrf:'test'}});
      if (url.pathname === '/api/settings') return route.fulfill({json:{settings:catalog.settings,revision:'test'}});
      if (url.pathname === '/api/tools') return route.fulfill({json:{...catalog,revision:'test'}});
      return route.fulfill({path:path.join(root,url.pathname)});
    });
    await page.goto(origin+'/tools.html?section=installment&project=da1');
    const card = page.locator('.tool-entry details').first();
    const summary = card.locator('summary');
    await summary.press('Enter');
    await summary.press('Escape');
    assert.equal(await card.evaluate(el=>el.open), false, 'Escape должен свернуть карточку');
    assert.ok(await summary.evaluate(el=>el===document.activeElement));

    const manage = page.locator('#tools-owner-link');
    await manage.press('Enter');
    const frame = page.frameLocator('#owner-window iframe');
    const actions = frame.locator('.tool-entry details').first();
    const actionsSummary = actions.locator('summary');
    await actionsSummary.press('Space');
    await actions.locator('[data-copy]').press('Escape');
    assert.equal(await actions.evaluate(el=>el.open),false);
    assert.ok(await actionsSummary.evaluate(el=>el===document.activeElement));
    await actionsSummary.press('Space');
    await actions.locator('[data-copy]').press('Enter');
    const dialog = frame.locator('#tools-editor');
    const sectionSummary = dialog.locator('.tools-form-context > summary');
    await sectionSummary.press('Space');
    const select = dialog.locator('.tools-form-context select:visible').first();
    assert.equal(await select.evaluate(el=>getComputedStyle(el).appearance),'base-select');
    await select.press('Space');
    assert.ok(await select.evaluate(el=>el.matches(':open')));
    await page.keyboard.press('Escape');
    assert.equal(await select.evaluate(el=>el.matches(':open')),false);
    assert.ok(await sectionSummary.evaluate(el=>el.parentElement.open));
    assert.ok(await dialog.isVisible());
    assert.ok(await select.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Escape');
    assert.ok(await dialog.isVisible(), 'Второй Escape закрывает вложенный раздел');
    assert.equal(await sectionSummary.evaluate(el=>el.parentElement.open),false);
    assert.ok(await sectionSummary.evaluate(el=>el===document.activeElement));
    assert.equal(await frame.locator('dialog[open]').count(),1);
    await sectionSummary.press('Escape');
    await dialog.waitFor({state:'hidden'});
    const edit = frame.locator('.tool-entry [data-edit]').first();
    await edit.press('Enter');
    const sample = () => dialog.evaluate(el=>{
      const style = getComputedStyle(el);
      return {open:el.open, display:style.display, opacity:Number(style.opacity),
        overlay:style.overlay, hit:style.pointerEvents};
    });
    assert.equal((await sample()).opacity,1);
    // Останавливаем эффекты в обработчике того же клика, пока кадр ещё доступен.
    await dialog.evaluate(el=>document.addEventListener('click', ()=>{
      getComputedStyle(el).display;
      for (const effect of el.getAnimations({subtree:true})) {
        if (!(effect instanceof CSSTransition) || effect.effect.target !== el) continue;
        effect.pause();
        effect.currentTime = effect.effect.getTiming().duration / 2;
      }
    }, {once:true}));
    await dialog.locator('#tools-cancel').click();
    const middle = await sample();
    assert.equal(middle.open,false);
    if (reducedMotion==='reduce') {
      assert.equal(middle.display,'none');
    } else {
      assert.ok(middle.opacity>0 && middle.opacity<1,JSON.stringify(middle));
      assert.equal(middle.overlay,'auto');
      assert.equal(middle.hit,'none');
      const backdrop = await dialog.evaluate(el=>Number(getComputedStyle(el,'::backdrop').opacity));
      assert.ok(backdrop>0 && backdrop<1);
    }
    await edit.press('Enter');
    assert.equal((await sample()).opacity,1);
    await page.keyboard.press('Escape');
    assert.equal((await sample()).display,'none');
    await edit.press('Enter');
    await dialog.locator('#tools-close').click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await sample()).overlay,'none');
    await edit.press('Enter');
    await dialog.locator('[type=submit]').click();
    await frame.locator('#tools-editor[open]').waitFor({state:'detached'});
    assert.equal((await sample()).display,'none','Сохранение должно закрыть форму сразу');

    const ai = frame.locator('#ai-dialog');
    await frame.locator('#tools-ai').click();
    await ai.locator('#ai-text').fill('Проверка перехода в форму');
    await ai.locator('#ai-build').click();
    await ai.locator('#ai-items button').click();
    assert.equal(await ai.evaluate(el=>getComputedStyle(el).display),'none');
    assert.ok(await dialog.isVisible());
    await dialog.locator('#tools-cancel').click();
    await ai.waitFor();
    assert.equal((await sample()).display,'none','Форма и предложения видны одновременно');
    await ai.locator('#ai-close').click();
    await ai.waitFor({state:'hidden'});
    await frame.locator('#owner-return').press('Escape');
    await manage.waitFor();
    assert.ok(await manage.evaluate(el=>el===document.activeElement));
  } finally { await page.close(); }
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN ||
    path.join(os.homedir(),'Desktop/Yandex.app/Contents/MacOS/Yandex')});
  try {
    for(const mode of ['no-preference','reduce']) await check(browser,mode);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
