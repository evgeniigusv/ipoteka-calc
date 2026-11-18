// node tests/flat-search.browser.cjs    CHROMIUM_BIN и FLAT_QA_DIR необязательны.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(require.resolve('playwright-core', {paths: [
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const root = path.resolve(__dirname, '..'), base = 'http://calc.test/';
const rows = ['42', '420', '49', '49', '5'].map((num, i) => ({
  house_id:6736582, num, floor:i + 2, rooms:2, area:52.3, price:8100000 + i * 100000,
  action:7500000, status:i === 1 ? 'Особые условия оформления. ' + 'ДлинноеНазвание'.repeat(8) : 'Свободна'
}));
rows.push({...rows[0], house_id:6871059, price:9900000});
const number = value => Number(value.replace(/\D/g, ''));
const focused = input => input.evaluate(el => el === document.activeElement);

async function motion(page, reduced) {
  const input = page.locator('#sm-flat-search');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sm-flat-search__popup')).opacity === '1');
  // Как только виден промежуточный кадр выхода, открываем тот же список повторно.
  // Проверяем реальный вход с полностью закрытого состояния отдельно от прерывания выхода.
  await input.press('Escape');
  await page.locator('.sm-flat-search__popup').waitFor({state:'hidden'});
  const openedGradually = await input.evaluate(async input => {
    input.click();
    const popup = document.querySelector('.sm-flat-search__popup');
    let intermediate = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame);
      const opacity = Number(getComputedStyle(popup).opacity);
      if (opacity === 1) break;
      if (opacity > 0) intermediate = true;
    }
    return intermediate;
  });
  assert.equal(openedGradually, !reduced);
  const frames = await input.evaluate(async input => {
    const popup = document.querySelector('.sm-flat-search__popup');
    const press = key => input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true}));
    press('Escape');
    const inaccessible = popup.inert && input.getAttribute('aria-expanded') === 'false';
    const intermediate = [];
    for (let i = 0; !popup.hidden && i < 30; i++) {
      await new Promise(requestAnimationFrame);
      const opacity = Number(getComputedStyle(popup).opacity);
      if (opacity > 0 && opacity < 1) { intermediate.push(opacity); break; }
    }
    press('ArrowDown');
    await Promise.allSettled(popup.getAnimations().map(a => a.finished));
    await new Promise(requestAnimationFrame);
    return {inaccessible, mid:intermediate.length > 0, open:!popup.hidden && !popup.inert,
      opacity:getComputedStyle(popup).opacity, active:input.getAttribute('aria-activedescendant')};
  });
  assert.equal(frames.inaccessible, true);
  assert.equal(frames.mid, !reduced);
  assert.equal(frames.open, true);
  assert.equal(frames.opacity, '1');
  assert.ok(frames.active);
}

async function check(browser, file, width, reduced) {
  const mobile = width < 600;
  const page = await browser.newPage({viewport:{width,height:mobile ? 780 : 900},
    isMobile:mobile, hasTouch:mobile, reducedMotion:reduced ? 'reduce' : 'no-preference'});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let releaseMacro;
  const delayed = new Promise(resolve => { releaseMacro = resolve; });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === '/assets/macro-flats.json') {
        await delayed;
        return route.fulfill({json:{updated:'19.11.2026', rows}});
      }
      return route.fulfill({path:path.join(root, url.pathname)});
    });
    await page.goto(base + file + '?theme=' + (mobile ? 'sm' : 'classic'), {waitUntil:'domcontentloaded'});
    assert.ok((await page.title()).length > 0);
    const input = page.getByRole('combobox', {name:'Номер квартиры', exact:true});
    const select = page.locator('#sm-flat'), price = page.locator('#sm-price');
    const popup = page.locator('.sm-flat-search__popup'), options = page.getByRole('listbox', {name:'Подсказки по номеру квартиры'}).getByRole('option');
    await input.fill('42');
    assert.match(await popup.innerText(), /Загрузка/);
    if (mobile) await price.fill('7777000');
    releaseMacro();
    await select.locator('option[value="1"]').waitFor({state:'attached'});
    if (mobile) {
      assert.equal(number(await price.inputValue()), 7777000, 'Поздняя загрузка сохранила ручную цену');
      assert.equal(await select.inputValue(), '');
      assert.equal(await input.getAttribute('aria-expanded'), 'false');
    } else {
      assert.equal(number(await price.inputValue()), rows[0].price);
      assert.equal(await select.inputValue(), '1');
      assert.ok(await focused(input));
    }
    await input.fill('999');
    assert.match(await popup.innerText(), /Совпадений нет/);
    await price.fill('7000000');
    await input.fill('4');
    assert.equal(number(await price.inputValue()), 7000000);
    assert.equal(await options.count(), 4);
    await input.press('ArrowLeft');
    assert.equal(await input.evaluate(el => el.selectionStart), 0);
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    assert.ok(await focused(input));
    const id = await input.getAttribute('aria-activedescendant');
    assert.match(await page.locator('#' + id).innerText(), /№ 420/);
    assert.equal(await input.inputValue(), '4');
    assert.equal(number(await price.inputValue()), 7000000, 'Стрелки не применяют квартиру');

    // Размеры и перенос проверяем на настоящем длинном названии в узком поле.
    const long = options.nth(1);
    const geometry = await long.evaluate(el => {
      const box = el.getBoundingClientRect();
      return {left:box.left, right:box.right, height:box.height, overflow:el.scrollWidth > el.clientWidth};
    });
    assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.height > 44);
    assert.equal(geometry.overflow, false);
    if (file === 'index.html') {
      const previousSize = page.viewportSize();
      await page.setViewportSize({width,height:400});
      for (const [block, above] of [['end',true],['start',false]]) {
        await input.evaluate((el, position) => el.scrollIntoView({block:position, behavior:'instant'}), block);
        await page.waitForFunction(expected => document.querySelector('.sm-flat-search__popup')
          .classList.contains('sm-flat-search__popup--above') === expected, above);
        const bounds = await popup.boundingBox(), field = await input.boundingBox();
        assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 401);
        assert.ok(above ? bounds.y + bounds.height < field.y : bounds.y >= field.y + field.height);
      }
      await page.setViewportSize(previousSize);
      await input.evaluate(el => el.scrollIntoView({block:'center',behavior:'instant'}));
      await motion(page, reduced);
      if (process.env.FLAT_QA_DIR) await page.screenshot({path:path.join(process.env.FLAT_QA_DIR, 'flat-search-' + width + '.png')});
      // После повторного открытия активна первая подсказка.
      await input.press('ArrowDown');
    }

    await page.evaluate(() => document.addEventListener('change', event => {
      if (event.target.id === 'sm-flat') window.atSelection = [event.target.value, document.querySelector('#sm-price').value];
    }));
    if (mobile) await long.tap(); else await input.press('Enter');
    assert.equal(await input.inputValue(), '420');
    assert.equal(await select.inputValue(), '2');
    assert.equal(number(await price.inputValue()), rows[1].price);
    assert.ok(await focused(input));
    const [value, atChange] = await page.evaluate(() => window.atSelection);
    assert.equal(value, '2'); assert.equal(number(atChange), rows[1].price);
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.equal(await input.getAttribute('aria-activedescendant'), null);

    await input.fill('49');
    assert.equal(await options.count(), 2);
    assert.equal(await select.inputValue(), '', 'При совпадении двух номеров нужен явный выбор');
    await input.press('Escape');
    assert.equal(await input.inputValue(), '49');
    await input.press('ArrowUp');
    assert.equal(await options.last().getAttribute('aria-selected'), 'true');
    await input.press('Tab');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.ok(await focused(select));

    await input.fill('4');
    await select.click();
    assert.ok(await popup.evaluate(el => el.hidden), 'При открытии соседнего списка подсказки скрыты');
    if (file === 'index.html' && !mobile) {
      // Быстрый переход в обратную сторону: даже закрывающийся ::picker не накладывается на подсказки.
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#sm-flat'), '::picker(select)').opacity === '1');
      await input.click();
      assert.equal(await input.getAttribute('aria-expanded'), 'true');
      const overlap = await popup.evaluate(async el => {
        const select = document.querySelector('#sm-flat');
        for (let i = 0; i < 18; i++) {
          await new Promise(requestAnimationFrame);
          const picker = getComputedStyle(select, '::picker(select)');
          if (picker.display !== 'none' && Number(picker.opacity) > 0 && Number(getComputedStyle(el).opacity) > 0) return true;
        }
        return false;
      });
      assert.equal(overlap, false);
    }
    await page.keyboard.press('Escape');
    await select.selectOption('1');
    assert.equal(await input.inputValue(), '42');
    assert.equal(number(await price.inputValue()), rows[0].price);
    await input.fill('кв. № 420');
    assert.equal(await select.inputValue(), '2');
    assert.equal(number(await price.inputValue()), rows[1].price);
    assert.equal(await input.inputValue(), 'кв. № 420', 'Точный ввод не перезаписывает текст');
    if (file === 'index.html' || file === 'rassrochka.html') {
      // Оба экрана начинают с демонстрационных 10 млн. Проверяем первое действие уже с загруженным Macro.
      await page.reload({waitUntil:'domcontentloaded'});
      await select.locator('option[value="1"]').waitFor({state:'attached'});
      assert.equal(number(await price.inputValue()), 10000000);
      await input.fill(mobile ? '999' : '4');
      assert.equal(await price.inputValue(), '');
      assert.equal(await select.inputValue(), '');
      await price.fill('8765000');
      for (const query of ['9999','4','']) {
        await input.fill(query);
        assert.equal(number(await price.inputValue()), 8765000);
        assert.equal(await select.inputValue(), '');
      }
      await page.locator('#sm-project button').nth(1).click();
      await page.locator('#sm-project button').first().click();
      await input.fill('999');
      assert.equal(number(await price.inputValue()), 8765000, 'Сохранённое ручное состояние проекта');
      await input.fill('42');
      assert.equal(number(await price.inputValue()), rows[0].price);
      await input.fill('999');
      assert.equal(await price.inputValue(), '', 'Цена выбранной квартиры не становится ручной');
    }
    assert.deepEqual(errors, []);
    console.log(file, width, '— ввод, выбор, клавиатура, фокус и поздняя загрузка проверены');
  } finally { releaseMacro(); await page.close(); }
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_BIN});
  try {
    for (const width of [1280,390,320]) {
      for (const file of ['index.html','rassrochka.html','chpv.html','transh.html'])
        await check(browser, file, width, width === 320);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
