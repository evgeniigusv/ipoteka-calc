// CHROMIUM_BIN=/path/to/browser node tests/select-motion.browser.cjs [--live]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(require.resolve('playwright-core', {paths: [
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const base = 'https://evgeniigusv.github.io/ipoteka-calc/';
const root = path.resolve(__dirname, '..');

async function frames(field, count = 18) {
  const {values, tops} = await field.evaluate(async (select, count) => {
    const values = [], tops = [];
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      const opacity = Number(getComputedStyle(select, '::picker(select)').opacity);
      values.push(opacity);
      if (opacity > 0) tops.push(select.options[0].getBoundingClientRect().top);
    }
    return {values, tops};
  }, count);
  if (tops.length) assert.ok(Math.max(...tops) - Math.min(...tops) < 1, 'Текст меню неподвижен во время перехода');
  return values;
}

async function run(browser, width, theme, reduced) {
  const page = await browser.newPage({viewport: {width, height: 780}, reducedMotion: reduced ? 'reduce' : 'no-preference'});
  try {
    if (!process.argv.includes('--live')) await page.route(base + '**', route => {
      const file = new URL(route.request().url()).pathname.slice('/ipoteka-calc/'.length) || 'index.html';
      return route.fulfill({path: path.join(root, file)});
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '?theme=' + theme, {waitUntil: 'domcontentloaded'});
    const field = page.locator('#sm-flat');
    await field.locator('option').nth(2).waitFor({state:'attached'});
    // Открытие у нижнего края, затем у верхнего. Страница и поле стоят на месте.
    for (const block of ['end', 'start']) {
      await field.evaluate((e, block) => e.scrollIntoView({block, behavior:'instant'}), block);
      const before = await field.boundingBox();
      await field.click();
      const values = await frames(field);
      assert.equal(values.at(-1), 1);
      assert.equal(values.some(v => v > 0 && v < 1), !reduced, 'Промежуточная прозрачность при открытии');
      const option = await field.locator('option').first().boundingBox();
      const after = await field.boundingBox();
      assert(Math.abs(before.y - after.y) < 1);
      assert(option.x >= 0 && option.x + option.width <= width && option.y >= 0 && option.y + option.height <= 781);
      assert(block === 'start' ? option.y > after.y : option.y < after.y, 'Список открывается со свободной стороны');
      await page.mouse.click(2, 100);
      const exit = await frames(field);
      assert.equal(exit.at(-1), 0);
      assert.equal(exit.some(v => v > 0 && v < 1), !reduced, 'Промежуточная прозрачность при закрытии');
    }
    await field.click();
    await page.mouse.click(2, 100);
    await field.click();
    assert(await field.evaluate(e => e.matches(':open')));
    await page.keyboard.press('Escape');
    assert(await field.evaluate(e => !e.matches(':open') && document.activeElement === e));
    await field.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert(await field.evaluate(e => !e.matches(':open') && e.selectedIndex > 0));
    const selection = await field.inputValue();
    await field.click();
    const last = field.locator('option').last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    assert.notEqual(await field.inputValue(), selection);
    assert(await page.locator('#sm-flat-search').inputValue());
    const price = await page.locator('#sm-price').inputValue();
    assert(Number(price.replace(/\D/g, '')) > 0);
    const label = await field.evaluate(el => el.selectedOptions[0].label);
    await field.click();
    const selected = page.getByRole('option', {name:label, exact:true});
    assert.equal(await selected.count(), 1);
    const layout = await selected.evaluate(el => {
      const bounds = part => el.querySelector(part).getBoundingClientRect();
      return {
        text: el.text, name:el.getAttribute('aria-label'),
        twoLines:bounds('.sm-flat-row__details').top >= bounds('.sm-flat-row__number').bottom,
        rendered:bounds('.sm-flat-row__number').height > 0
      };
    });
    assert.deepEqual(layout, {text:label, name:label, twoLines:true, rendered:true});
    await page.keyboard.press('Escape');
    assert.equal(await field.evaluate(el => el.selectedOptions[0].label), label);
    assert.deepEqual(errors, []);
    console.log(theme, width, reduced ? 'уменьшенное движение' : 'обычное движение', '— границы, кадры, прокрутка, повторный клик, клавиатура и выбор квартиры проверены');
  } finally { await page.close(); }
}
// Моделируем отсутствие оформляемого picker и проверяем настоящие текстовые option.
async function nativeFallback(browser) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args[0] !== 'appearance: base-select' && supports(...args);
    });
    await page.route(base + '**', route => {
      const file = new URL(route.request().url()).pathname.slice('/ipoteka-calc/'.length) || 'index.html';
      if (file === 'assets/select.css') {
        const sharedStyles = fs.readFileSync(path.join(root,file), 'utf8').split('@supports (appearance: base-select)')[0];
        return route.fulfill({contentType:'text/css', body:sharedStyles});
      }
      return route.fulfill({path:path.join(root, file)});
    });
    await page.goto(base);
    const field = page.locator('#sm-flat'), first = field.locator('option').nth(1);
    await first.waitFor({state:'attached'});
    const label = await first.textContent();
    assert.match(label, /^№ .+ · этаж .+ · .+ м²/);
    assert.equal(await first.locator('*').count(), 0);
    await field.selectOption({label});
    assert.equal(await field.evaluate(el => el.selectedOptions[0].label), label);
    assert.ok(Number((await page.locator('#sm-price').inputValue()).replace(/\D/g,'')) > 0);
    const search = page.locator('#sm-flat-search');
    await search.focus();
    const list = page.getByRole('listbox', {name:'Подсказки по номеру квартиры'});
    assert.equal(await list.getByRole('option', {name:label,exact:true}).count(), 1);
    console.log('Системный select — полная подпись, выбор, цена и отдельный поиск проверены');
  } finally { await page.close(); }
}
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_BIN});
  try {
    if (!process.argv.includes('--live')) await nativeFallback(browser);
    for (const args of [[1280,'classic',false], [1280,'sm',false], [390,'classic',false], [390,'sm',false], [320,'classic',true]]) await run(browser, ...args);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
