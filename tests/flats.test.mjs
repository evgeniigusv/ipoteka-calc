import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; this.textContent = ''; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
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
const context = { window: {}, document: { getElementById: () => search }, Option: class { constructor(text, value) { this.text = text; this.value = value; } }, fetch: async () => ({ ok: true, json: async () => ({ updated: '04.11.2026', rows }) }), Intl };
vm.runInNewContext(fs.readFileSync(new URL('../assets/flats.js', import.meta.url), 'utf8'), context);
const flats = context.window.SMFlats.setup({ select, info, price, discount: disc, project: 'ДА — 1 очередь', onChange() {} });
await new Promise(resolve => setTimeout(resolve, 0));
search.value = 'кв. № 1'; search.trigger('input');
assert.equal(select.value, '1'); assert.equal(price.value.replace(/\D/g, ''), '10000000'); assert.equal(disc.value, '10,00'); assert.equal(flats.cashPrice(),9000000); disc.value='11'; assert.equal(flats.cashPrice(),null);
search.value = '7'; search.trigger('input');
assert.equal(select.value, '2'); assert.equal(price.value.replace(/\D/g, ''), '11000000'); assert.equal(flats.isPif(), false);
assert.equal(select.children.some(item => /ПИФ/.test(item.text)), false);
search.value = '9'; search.trigger('input'); assert.equal(select.value, ''); assert.match(info.textContent, /несколько квартир/);
search.value = '9999'; search.trigger('input'); assert.equal(price.value, ''); assert.equal(flats.selectedNumber(), '9999'); assert.match(info.textContent, /не найдена/);
flats.setProject('ДА — 2 очередь'); assert.equal(disc.value,''); assert.equal(flats.cashPrice(),null); search.value = '1'; search.trigger('input'); assert.equal(price.value.replace(/\D/g, ''), '13000000'); assert.equal(flats.isPif(), false);
console.log('Поиск по номеру, исключение ПИФ, ручной ввод и очереди — проверены');
