// node tests/program-selection.browser.cjs [--live]
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const {chromium} = require(require.resolve('playwright-core', {paths: [
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const base='https://evgeniigusv.github.io/ipoteka-calc/';
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_BIN});
 try{
 for(const [theme,width,reduced] of [['sm',1280,false],['classic',390,false],['sm',320,true]]){
  const ctx=await b.newContext({viewport:{width,height:850},reducedMotion:reduced?'reduce':'no-preference'});
  if(!process.argv.includes('--live')) await ctx.route(base+'**',r=>r.fulfill({path:path.resolve(root, new URL(r.request().url()).pathname.slice('/ipoteka-calc/'.length)||'index.html')}));
  const p=await ctx.newPage(), errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(() => {
    window.indicatorFrames = new Set();
    window.contentFrames = new Set();
    addEventListener('DOMContentLoaded', () => {
      const stop = performance.now() + 3000;
      function sample() {
        for (const a of document.getAnimations()) {
          if (a.playState !== 'running') continue;
          const el = a.effect.target;
          if (a.id === 'sm-section-indicator') window.indicatorFrames.add(getComputedStyle(el).transform);
          if (a.id === 'sm-section-content') window.contentFrames.add(getComputedStyle(el).opacity);
        }
        if (performance.now() < stop) requestAnimationFrame(sample);
      }
      sample();
    }, {once:true});
    window.routeMovement = [];
    addEventListener('pagereveal', event => {
      const transition = event.viewTransition;
      if (!transition) return;
      transition.ready.then(() => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;
          if (!effect.pseudoElement?.startsWith('::view-transition')) continue;
          if (effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none')) window.routeMovement.push(animation.animationName || 'transform');
        }
      }, () => {});
    });
  });
  async function checkCurrentSection() {
    const current = p.locator('.sm-navigation a[aria-current="page"]');
    const initial = await p.evaluate(() => performance.timeOrigin);
    const price = p.locator('#sm-price');
    const amount = await price.count() ? await price.inputValue() : null;
    await current.dblclick();
    await current.press('Enter');
    assert.equal(await p.evaluate(() => performance.timeOrigin), initial, 'Повторный выбор перезагрузил страницу');
    if (amount !== null) assert.equal(await price.inputValue(), amount);
  }
  let releaseCatalog;
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  await p.route('**/assets/tools.json', async route => {
    await catalogGate;
    if (process.argv.includes('--live')) await route.continue();
    else await route.fulfill({path: path.join(root, 'assets/tools.json')});
  }, { times: 1 });
  await p.goto(base + '?theme=' + theme, {waitUntil: 'domcontentloaded'});
  await p.locator('.sm-mortgage-loading').waitFor();
  await p.evaluate(() => document.fonts.ready);
  const result = p.locator('#calc-result');
  const loadingHeight = (await result.boundingBox()).height;
  releaseCatalog();
  await p.locator('#sm-detail .sm-pay').waitFor();
  const finalHeight = (await result.boundingBox()).height;
  assert(loadingHeight >= finalHeight * 0.8, 'При загрузке ставок карточка расчёта схлопнулась');
  for(const name of ['index','rassrochka','chpv','transh']){
   await p.goto(base+name+'.html?theme='+theme,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.SM_TOOLS_DATA && document.querySelector('#sm-project button'));
   if (name === 'index') {
     const project = p.locator('#sm-project button').nth(1);
     await project.click();
     assert.equal(await project.evaluate(el => el.getAnimations().some(a => a.id === 'sm-button-release')), !reduced);
     await p.waitForFunction(() => document.querySelector('#sm-flat').options.length > 1);
     await p.locator('#sm-flat').selectOption({index:1});
     assert.equal(await p.locator('#calc-result .sm-hero.sm-program-enter').count(), reduced ? 0 : 1);
     await p.locator('#sm-project button').first().click();
   }
   if(name==='index'||name==='rassrochka'){
    if(name==='rassrochka')await p.locator('#sm-down-rub').fill('4500000');
    const rows=p.locator('#sm-tbody tr.sm-pick');
    if(await rows.count()<2 && name==='index') await p.locator('#sm-type button').nth(1).click();
    assert((await rows.count())>=2,name+' row count');
    const target=p.locator('#sm-tbody .sm-pick:not(.sm-sel)').first();
    const id=await target.getAttribute('data-id');
    await p.evaluate(()=>window.originalRows=[...document.querySelectorAll('#sm-tbody tr')]);
    await target.click();assert.equal(await p.locator('#sm-tbody .sm-sel').getAttribute('data-id'),id);
    assert(await p.evaluate(()=>originalRows.every((r,i)=>r===document.querySelectorAll('#sm-tbody tr')[i])));
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),reduced?0:1);
    const before=await p.locator('#sm-detail').innerText();
    await p.locator('#sm-price').dispatchEvent('input');
    assert.equal(await p.locator('#sm-detail').innerText(),before);
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),0);
    const k=p.locator(name==='index'?'#sm-tbody .sm-pick:not(.sm-sel)':'#sm-tbody .sm-pick:not(.sm-sel) button').first();
    await k.focus();await k.press('Enter');
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),0);
    assert(await p.evaluate(()=>document.activeElement.closest('tr')===document.querySelector('#sm-tbody .sm-sel')));
   }else{
    const field=p.locator('#sm-program');
    assert((await field.locator('option').count())>=2);
    await p.locator('#sm-price').fill('10000000');
    if(name==='chpv'){await p.locator('#sm-cash').fill('8500000');await p.locator('#sm-ddu').fill('9500000');}
    await p.locator('h1').click();
    await field.selectOption({index:1});
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),reduced?0:1);
    await field.focus();await field.press('Escape');await field.selectOption({index:0});
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),0);
    await p.locator('#sm-price').fill('9999999');
    assert.equal(await p.locator('#calc-result .sm-program-enter').count(),0);
   }
   await checkCurrentSection();
  }
  // Пока следующее HTML-окно в сети, текущий индикатор и расчёт должны оставаться вместе.
  await p.evaluate(() => {
    document.addEventListener('click', () => {
      setTimeout(() => {
        const link = document.querySelector('.sm-navigation a[aria-current]');
        const pill = link.querySelector('.sm-nav-indicator');
        const aligned = !pill.getAnimations().length && Math.abs(pill.getBoundingClientRect().left - link.getBoundingClientRect().left) < 2;
        sessionStorage.setItem('test-menu-aligned', String(aligned));
      }, 60);
    }, {once:true});
  });
  await p.route('**/tools.html?*', async route => {
    if (!route.request().isNavigationRequest()) { await route.abort(); return; }
    await new Promise(resolve => setTimeout(resolve, 180));
    if (process.argv.includes('--live')) await route.continue();
    else await route.fulfill({path: path.join(root, 'tools.html')});
  });
  await p.locator('.sm-navigation a[href*="tools.html"]').click();
  assert.equal(await p.evaluate(() => sessionStorage.getItem('test-menu-aligned')), 'true');
  await p.waitForFunction(() => window.SM_TOOLS_DATA);
  if (!reduced) await p.waitForFunction(() => indicatorFrames.size > 1 && contentFrames.size > 1);
  else assert.equal(await p.evaluate(() => indicatorFrames.size + contentFrames.size), 0);
  assert.deepEqual(await p.evaluate(() => window.routeMovement), []);
  await p.locator('[data-tools-view="flats"]').click();
  assert.equal(new URL(p.url()).searchParams.get('view'), 'flats');
  assert.equal(await p.locator('#tools-settings-panel').evaluate(panel => getComputedStyle(panel).animationName), 'none');
  const toolsOrigin = await p.evaluate(() => performance.timeOrigin);
  await p.locator('.sm-navigation a[aria-current="page"]').click();
  assert.equal(await p.locator('[data-tools-view="catalog"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.evaluate(() => performance.timeOrigin), toolsOrigin);
  await checkCurrentSection();
  await p.goBack();
  assert.equal(await p.locator('[data-tools-view="flats"]').getAttribute('aria-pressed'), 'true');
  await p.locator('.sm-navigation a[href*="rassrochka.html"]').click();
  await p.waitForFunction(() => window.SM_TOOLS_DATA);
  if (!reduced) await p.waitForFunction(() => indicatorFrames.size > 1 && contentFrames.size > 1);
  else assert.equal(await p.evaluate(() => indicatorFrames.size + contentFrames.size), 0);
  assert.deepEqual(await p.evaluate(() => window.routeMovement), []);
  assert.deepEqual(errors,[]);console.log(theme,width,'4 калькулятора: выбор, клавиатура, ввод, расчёт и фокус проверены');await ctx.close();
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
