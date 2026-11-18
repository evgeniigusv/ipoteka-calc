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
  for(const name of ['index','rassrochka','chpv','transh']){
   await p.goto(base+name+'.html?theme='+theme);await p.waitForFunction(()=>window.SM_TOOLS_DATA && document.querySelector('#sm-project button'));
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
  }
  assert.deepEqual(errors,[]);console.log(theme,width,'4 калькулятора: выбор, клавиатура, ввод, расчёт и фокус проверены');await ctx.close();
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
