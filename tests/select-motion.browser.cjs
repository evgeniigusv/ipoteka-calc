// CHROMIUM_BIN=/path/to/browser node tests/select-motion.browser.cjs [--live]
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(require.resolve('playwright-core', {paths: [
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const base = 'https://evgeniigusv.github.io/ipoteka-calc/';
const root = path.resolve(__dirname, '..');

async function frames(field, count = 18) {
  return field.evaluate(async (select, count) => {
    const values = [];
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      values.push(Number(getComputedStyle(select, '::picker(select)').opacity));
    }
    return values;
  }, count);
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
    assert.deepEqual(errors, []);
    console.log(theme, width, reduced ? 'уменьшенное движение' : 'обычное движение', '— границы, кадры, прокрутка, повторный клик, клавиатура и выбор квартиры проверены');
  } finally { await page.close(); }
}
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_BIN});
  try {
    for (const args of [[1280,'classic',false], [390,'sm',false], [320,'classic',true]]) await run(browser, ...args);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
