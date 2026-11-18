// node tests/theme.browser.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(require.resolve('playwright-core', {paths:[
  __dirname, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
]}));
const root = path.resolve(__dirname, '..');
const fs = require('node:fs/promises');
const http = require('node:http');
const pages = ['index.html','rassrochka.html','chpv.html','transh.html','tools.html'];
const types = {html:'text/html; charset=utf-8', js:'text/javascript', css:'text/css', json:'application/json', svg:'image/svg+xml'};

// Реальный HTTP-ответ позволяет Chromium поместить страницу в BFCache.
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (req.method !== 'GET' || !(pages.includes(file) || file.startsWith('assets/'))) {
    res.writeHead(404).end(); return;
  }
  try {
    const data = await fs.readFile(path.join(root, file));
    res.writeHead(200, {'Content-Type':types[path.extname(file).slice(1)] || 'application/octet-stream'}).end(data);
  } catch { res.writeHead(404).end(); }
});

async function check(page, expected) {
  const selected = page.getByRole('button', {name:expected === 'dark' ? 'Тёмная' : 'Светлая', exact:true, pressed:true});
  await selected.waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), expected);
  assert.equal(await page.locator('[data-theme-choice][aria-pressed=true]').count(), 1);
}
(async () => {
  const browser = await chromium.launch({channel:'chromium', executablePath:process.env.CHROMIUM_BIN,
    ignoreDefaultArgs:['--disable-back-forward-cache']});
  try {
    const ctx = await browser.newContext({colorScheme:'dark'});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    await ctx.addInitScript(() => {
      const capture = () => {
        if (!document.body) return requestAnimationFrame(capture);
        window.firstTheme = document.documentElement.dataset.theme;
      };
      requestAnimationFrame(capture);
      addEventListener('pageshow', e => {
        if (e.persisted) requestAnimationFrame(() => { window.restoredTheme = document.documentElement.dataset.theme; });
      });
    });
    const page = await ctx.newPage();
    const saved = () => page.evaluate(() => localStorage.getItem('ipoteka-calc.theme'));
    for (const file of pages) {
      await page.goto(base + file);
      await check(page, 'dark');
      await page.waitForFunction(() => window.firstTheme === 'dark');
      const links = await page.locator('.sm-navigation a').evaluateAll(list => list.map(a => a.href));
      assert(links.every(href => !new URL(href).searchParams.has('theme')));
    }
    await page.emulateMedia({colorScheme:'light'});
    await check(page, 'light');
    assert.equal(await saved(), null);
    await page.evaluate(() => localStorage.setItem('ipoteka-calc.theme', 'sm'));
    await page.emulateMedia({colorScheme:'dark'});
    await page.reload();
    await check(page, 'dark');
    for (const alias of ['sm','classic']) {
      await page.goto(base + '?theme=' + alias + '&v=probe#calc-result');
      await check(page, 'light');
      assert.equal(await saved(), 'sm');
      assert.equal(new URL(page.url()).hash, '#calc-result');
      assert.equal(new URL(page.url()).searchParams.get('v'), 'probe');
    }
    await page.getByRole('button', {name:'Тёмная',exact:true}).click();
    assert.equal(await saved(), 'dark');
    await page.goto(base + 'chpv.html?theme=classic&v=probe');
    await check(page, 'dark');
    const next = page.locator('.sm-navigation a[href*="transh.html"]');
    const destination = new URL(await next.getAttribute('href'));
    assert.equal(destination.searchParams.get('theme'), 'dark');
    assert.equal(destination.searchParams.get('v'), 'probe');
    await next.click();
    await check(page, 'dark');
    await page.getByRole('button', {name:'Светлая',exact:true}).click();
    await page.goBack();
    await check(page, 'light');
    await page.waitForFunction(() => window.restoredTheme === 'light', null, {timeout:3000});
    assert.equal(new URL(page.url()).searchParams.get('theme'), 'light');
    await page.emulateMedia({colorScheme:'dark'});
    await check(page, 'light');
    const other = await ctx.newPage();
    await other.goto(base + '?theme=dark');
    await check(page, 'dark');
    assert.equal(await saved(), 'dark');
    await page.goto(base + '?theme=light');
    await check(page, 'light');
    await check(other, 'light');
    assert.equal(await saved(), 'light');
    console.log('Пять страниц, первый кадр, системная тема, обе старые ссылки, явный выбор, переходы, вкладки и возврат из BFCache проверены.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
