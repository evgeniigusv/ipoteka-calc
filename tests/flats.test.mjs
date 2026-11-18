import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; this.textContent = ''; this.style = {}; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  after(node) { this.nextSibling = node; }
  add(option) { this.children.push(option); }
  replaceChildren(option) { this.children = [option]; this.value = ''; }
  trigger(name) { this.listeners[name](); }
}
const search = new Element(), select = new Element(), info = new Element(), price = new Element(), disc = new Element();
const rows = [
  { house_id: 6736582, num: '1', price: 10000000, action: 9000000, area: 40, floor: 2, rooms: 1 },
  { house_id: 6736582, num: '7', price: 11000000, area: 50, floor: 3, rooms: 2 },
  { house_id: 10899161, num: '7', price: 12000000, area: 55, floor: 3, rooms: 2 },
  { house_id: 6871059, num: '1', price: 13000000, area: 60, floor: 4, rooms: 2 },
  { house_id: 6736582, num: '9', price: 14000000, area: 60, floor: 4, rooms: 2 },
  { house_id: 6736582, num: '9', price: 15000000, area: 61, floor: 5, rooms: 2 }
];
let finishMetadata;
const events = {};
const context = { window: { SM_TOOLS_READY: new Promise(resolve => { finishMetadata = resolve; }), addEventListener(name, fn) { events[name] = fn; } }, document: { getElementById: () => search, createElement: () => new Element() }, Option: class { constructor(text, value) { this.text = text; this.value = value; } }, fetch: async () => ({ ok: true, json: async () => ({ updated: '04.11.2026', rows }) }), Intl };
vm.runInNewContext(fs.readFileSync(new URL('../assets/flats.js', import.meta.url), 'utf8'), context);
const flats = context.window.SMFlats.setup({ select, info, price, discount: disc, project: 'ДА — 1 очередь', onChange() {} });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(info['data-action-needed'], 'false');
search.value = 'кв. № 1'; search.trigger('input');
assert.equal(select.value, '1'); assert.equal(price.value.replace(/\D/g, ''), '10000000'); assert.equal(disc.value, '10,00'); assert.equal(flats.cashPrice(),9000000); disc.value='11'; assert.equal(flats.cashPrice(),null);
search.value = '7'; search.trigger('input');
assert.equal(select.value, '2'); assert.equal(price.value.replace(/\D/g, ''), '11000000'); assert.equal(flats.isPif(), false);
assert.equal(select.children.some(item => /ПИФ/.test(item.text)), false);
search.value = '9'; search.trigger('input'); assert.equal(select.value, ''); assert.match(info.textContent, /несколько квартир/);
assert.equal(info['data-action-needed'], 'true');
select.value = '3'; select.trigger('change');
assert.equal(info['data-action-needed'], 'false');
search.value = '9999'; search.trigger('input'); assert.equal(price.value, ''); assert.equal(flats.selectedNumber(), '9999'); assert.match(info.textContent, /не найдена/); assert.equal(info['data-action-needed'], 'true');
flats.setProject('ДА — 2 очередь'); assert.equal(disc.value,''); assert.equal(flats.cashPrice(),null); search.value = '1'; search.trigger('input'); assert.equal(price.value.replace(/\D/g, ''), '13000000'); assert.equal(flats.isPif(), false);
console.log('Поиск по номеру, исключение ПИФ, ручной ввод и очереди — проверены');
// Regression from the screen recording: switching projects must not erase a manual comparison price.
flats.setProject('ДА — 2 очередь');
assert.equal(flats.selectedNumber(),'1');
assert.equal(price.value.replace(/\D/g,''),'13000000');
flats.setProject('ДНК — 2 очередь');
assert.equal(price.value,''); // A catalog price must never become a different project's apartment price.
assert.equal(flats.selectedNumber(),'');
price.value='10 000 000';
flats.setProject('ДА — 2 очередь');
assert.equal(flats.selectedNumber(),'1');
assert.equal(price.value.replace(/\D/g,''),'13000000');
flats.setProject('ДНК — 2 очередь');
assert.equal(price.value,'10 000 000');
assert.equal(flats.selectedNumber(),'');
search.value='';search.trigger('input');price.value='12 000 000';
// A previously unseen project gets the manual budget, with no apartment identity attached.
flats.setProject('Тестовый проект');
assert.equal(price.value,'12 000 000');assert.equal(flats.selectedNumber(),'');
price.value='15 000 000';flats.setProject('ДНК — 2 очередь');
assert.equal(price.value,'12 000 000');
flats.setProject('Тестовый проект');assert.equal(price.value,'15 000 000');
console.log('Переключение проектов: ручная цена сохраняется, квартира восстанавливается только в своём проекте');

// Метаданные приходят после выбора: предупреждение должно появиться без повторного поиска.
flats.setProject('ДА — 1 очередь');
search.value = '1'; search.trigger('input');
const warning = info.nextSibling;
assert.equal(warning.hidden, true);
context.window.SM_TOOLS_DATA = { settings: { specialFlats: ['6736582:1'] } };
finishMetadata(); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(warning.hidden, false);
assert.equal(warning.role, 'alert');
assert.equal(warning.children.map(x => x.textContent).join('\n\n'), 'ВНИМАНИЕ!\n\nКвартира доступна к покупке только при 100% оплате или по любой ипотечной программе без субсидирования.');
assert.match(warning.style.cssText, /color:var\(--indian-text/);
assert.equal(price.value.replace(/\D/g, ''), '10000000');
assert.ok(select.children.some(option => option.value === '1'), 'Спецквартира остаётся в списке');

// Одинаковые номера в разных домах не переносят флаг между проектами.
flats.setProject('ДА — 2 очередь'); search.value = '1'; search.trigger('input');
assert.equal(warning.hidden, true);
flats.setProject('ДА — 1 очередь'); assert.equal(warning.hidden, false);
search.value = '999'; search.trigger('input'); assert.equal(warning.hidden, true);
search.value = ''; search.trigger('input'); assert.equal(warning.hidden, true);
select.value = '1'; select.trigger('change'); assert.equal(warning.hidden, false);
select.value = ''; select.trigger('change'); assert.equal(warning.hidden, true);
search.value = '1'; search.trigger('input'); assert.equal(warning.hidden, false);
context.window.SM_TOOLS_DATA.settings.specialFlats = [];
events['sm-settings-changed'](); assert.equal(warning.hidden, true);
context.window.SM_TOOLS_DATA = undefined;
context.window.SM_DATA = { settings: { specialFlats: ['6736582:1'] } };
events['sm-settings-changed'](); assert.equal(warning.hidden, false);
search.value = '9'; search.trigger('input'); assert.equal(warning.hidden, true);

// Все четыре экрана действительно подключают общий выбор квартиры, без фильтра по программе.
for (const calculator of ['ipoteka', 'rassrochka', 'chpv', 'transh']) {
  assert.match(fs.readFileSync(new URL('../assets/' + calculator + '.js', import.meta.url), 'utf8'), /SMFlats\.setup\(/);
}
console.log('Спецквартиры: поздние метаданные, стабильный ключ, выбор, поиск, восстановление, очистка и снятие флага — проверены');
