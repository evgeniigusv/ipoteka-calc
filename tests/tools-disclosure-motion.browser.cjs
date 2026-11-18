// Локальная проверка в Яндекс Браузере. CHROMIUM_BIN позволяет проверить другой браузер.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(require.resolve('playwright-core', {paths:[
  __dirname, path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const root = path.resolve(__dirname,'..');
const base = 'http://127.0.0.1:8410/';

async function check(browser,width) {
  const page = await browser.newPage({viewport:{width,height:900}});
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.route('**/*',r=>{
      const url = new URL(r.request().url());
      assert.equal(url.origin,new URL(base).origin);
      return r.fulfill({path:path.join(root,url.pathname)});
    });
    await page.goto(base+'tools.html?theme=sm');
    const group = page.locator('[data-mortgage-type]').first();
    const rows = page.locator('#tools-rows');
    const carrier = page.locator('.tools-group-carrier');
    const clip = carrier.locator('.tools-group-clip');
    const summary = rows.locator('details > summary').first();
    await summary.waitFor();
    await page.evaluate(()=>document.fonts.ready);

    // Ставим только браузерную анимацию на паузу для измерения промежуточного кадра.
    const middle = progress => page.evaluate(progress=>{
      const a=document.getAnimations().find(a=>a.id==='tools-group-height');
      if(!a)return null;
      a.pause();
      a.currentTime=a.effect.getTiming().duration*progress;
      return a.effect.target.offsetHeight;
    },progress);
    const settle = () => page.evaluate(()=>{
      document.getAnimations().find(a=>a.id==='tools-group-height')?.finish();
    });
    const pressGroup = () => group.click({force:true});

    await pressGroup();
    const half=await middle(.45);
    assert.ok(half>0);
    const full=await clip.locator('table').evaluate(t=>t.getBoundingClientRect().height);
    assert.ok(half<full);
    assert.equal(await group.getAttribute('aria-expanded'),'true');
    await pressGroup();
    assert.equal(await group.getAttribute('aria-expanded'),'false');
    assert.equal(await carrier.evaluate(el=>el.inert),true);
    assert.ok(Math.abs((await clip.boundingBox()).height-half)<full*.1,'Скачок при развороте');
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='tools-group-height').length),1);
    await pressGroup();
    assert.equal(await carrier.evaluate(el=>el.inert),false);
    await middle(.95);
    const cell = clip.locator('tr').first().locator('td').first();
    const geometry = await cell.evaluate(el=>[el.offsetWidth,el.offsetHeight]);
    await settle();
    await carrier.waitFor({state:'detached'});
    const normalCell = group.locator('xpath=ancestor::tr/following-sibling::tr[1]/td[1]');
    assert.deepEqual(await normalCell.evaluate(el=>[el.offsetWidth,el.offsetHeight]),geometry);
    await group.press('Space');
    assert.equal(await carrier.count(),0);
    assert.equal(await group.evaluate(el=>el===document.activeElement),true);

    await summary.click();
    function contentFrame(locator=summary) {
      return locator.evaluate(s=>{
        const details=s.parentElement;
        return {h:parseFloat(getComputedStyle(details,'::details-content').blockSize),
          full:details.querySelector('.tool-full').offsetHeight,open:details.open};
      });
    }
    async function midCard(open) {
      await page.waitForFunction(open=>{
        const d=document.querySelector('#tools-rows .tool-entry details');
        const h=parseFloat(getComputedStyle(d,'::details-content').blockSize);
        return d.open===open && h>1 && h<d.querySelector('.tool-full').offsetHeight-1;
      },open,{timeout:1200});
    }
    await midCard(true);
    await summary.click({force:true});
    await midCard(false);
    await summary.press('Enter');
    const instant=await contentFrame();
    assert.ok(instant.open && Math.abs(instant.h-instant.full)<1);
    await page.locator('[data-tools-view="catalog"]').click();
    assert.equal((await contentFrame()).open,true,'Повторный выбор вкладки свернул карточку');

    const section = rows.locator('[data-category=mortgage]');
    await section.click();
    await middle(.4);
    await page.emulateMedia({reducedMotion:'reduce'});
    await carrier.waitFor({state:'detached'});
    await section.click();
    assert.equal(await carrier.count(),0);
    await group.click();
    assert.equal(await group.getAttribute('aria-expanded'),'true');
    assert.equal(await carrier.count(),0);
    const wasOpen=(await contentFrame()).open;
    await summary.click();
    const noMotion=await contentFrame();
    assert.equal(await summary.evaluate(s=>getComputedStyle(s.parentElement,'::details-content').transitionDuration),'0s');
    assert.equal(noMotion.open,!wasOpen);
    await page.emulateMedia({reducedMotion:'no-preference'});

    await pressGroup();
    await middle(.5);
    const pdf=await page.pdf({format:'A4'});
    assert.equal(pdf.subarray(0,4).toString(),'%PDF');
    assert.equal(await carrier.count(),0);
    assert.equal(await group.getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(width+' px — карточка, группа, разворот, клавиатура, уменьшенное движение и PDF проверены.');
  } finally { await page.close(); }
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN ||
    path.join(os.homedir(),'Desktop/Yandex.app/Contents/MacOS/Yandex')});
  try {
    for(const width of [1280,390])await check(browser,width);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
