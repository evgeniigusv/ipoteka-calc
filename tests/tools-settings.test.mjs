import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Только DOM/API-макеты: тест не подключается к редактору и не меняет реальные флаги.
class Element {
  constructor(tag = '') {
    this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {};
    this.value = ''; this.classList = { toggle() {} }; this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  before(node) { this.previous = node; }
  replaceChildren(...nodes) { this.children = nodes; }
  add(option) { if (!this.children.length) this.value = option.value; this.append(option); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  async trigger(name) { await this.listeners[name]?.(); }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...(child.querySelectorAll?.(tag) || [])]); }
  checkValidity() { if (this.value === '') return !this.required; return Number(this.value) >= Number(this.min) && Number(this.value) <= Number(this.max); }
  getAttribute(name) { return this[name]; }
  reportValidity() { this.reported = true; }
  remove() { this.removed = true; }
}
const toolbar = new Element(), events = {}, requests = [], accepted = [];
let data = { revision: 'old', settings: {}, records: [{kind:'chpv',project:'da1',enabled:false}] }, allowed = true, nextPost, apiError;
const settings = { moneyCost: {da1:.25, da2:.5, dnk2:null}, subsidyCompensation: { da1: .1, da2: .1, dnk2: .1 }, specialFlats: ['999:retired'] };
const rows = [
  { house_id: 6736582, num: '1', floor: 1, area: 45 },
  { house_id: 6871059, num: '1', floor: 2, area: 50 },
  { house_id: 11013930, num: '20', floor: 3, area: 60 },
  { house_id: 111, num: '30', floor: 4, area: 70 }
];
let inventoryRequests = 0;
const context = {
  window: {
    SM_DATA: {}, SM_TOOLS_DATA: {},
    addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name) { delete events[name]; },
    dispatchEvent(event) { events[event.type]?.(event); }
  },
  Event: class { constructor(type) { this.type = type; } },
  Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
  document: { createElement: tag => new Element(tag), querySelector: () => toolbar },
  fetch: async path => { inventoryRequests++; assert.equal(path, 'assets/macro-flats.json'); return { ok: true, json: async () => ({ rows }) }; }
};
vm.runInNewContext(fs.readFileSync(new URL('../assets/tools-settings.js', import.meta.url), 'utf8'), context);
const clone = x => JSON.parse(JSON.stringify(x));
const options = {
  getData: () => data,
  canSave: () => allowed,
  api: async (path, body) => {
    requests.push({ path, body: body && clone(body) });
    assert.equal(path, '/api/settings');
    if (apiError) throw new Error(apiError);
    if (!body) return { revision: 'fresh', settings: clone(settings) };
    if (nextPost) return nextPost;
    return { data: { revision: 'saved-' + requests.length, settings: clone(body.settings) }, published: false, error: 'Тест публикации' };
  },
  onSaved: result => { accepted.push(result); data = result.data; }
};
const ui = context.window.SMToolsSettings.setup(options);
assert.equal(context.window.SMToolsSettings.setup(options), ui, 'Повторная инициализация не создаёт вторую панель');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(accepted.length, 0, 'GET настроек не переустанавливает каталог инструментов');
const host = toolbar.previous, [capSection, costSection, flatSection] = host.querySelectorAll('details');
assert.equal(host.tag, 'details'); assert.ok(!host.open, 'Настройки продаж по умолчанию свёрнуты');
const caps = capSection.querySelectorAll('input');
assert.deepEqual(caps.map(input => input.value), ['10', '10', '10']);
assert.ok(caps.every(input => input.required));
const costs = costSection.querySelectorAll('input');
assert.deepEqual(costs.map(input => input.value), ['25', '50', '']);
assert.equal(costs[0].required, true, 'Учитывается выключенная программа');
assert.equal(costs[2].required, false);
costs[0].value = '0'; await costs[0].trigger('input');
costs[2].value = '12.375'; await costs[2].trigger('input');
flatSection.open = true; await flatSection.trigger('toggle'); await new Promise(resolve => setTimeout(resolve, 0));
const flatList = flatSection.querySelectorAll('div').find(el => el.className === 'tools-settings-flats');
assert.equal(flatList.querySelectorAll('input').length, 0, 'До выбора проекта список пуст');
const [filter] = flatSection.querySelectorAll('select'), [search] = flatSection.querySelectorAll('input');
assert.equal(inventoryRequests, 0);
filter.value = 'da2'; await filter.trigger('change');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(inventoryRequests, 1);
assert.equal(flatList.querySelectorAll('input').length, 1);
let checkbox = flatList.querySelectorAll('input')[0];
checkbox.checked = true; await checkbox.trigger('change');
assert.equal(ui.isDirty(), true);
filter.value = 'dnk2'; await filter.trigger('change');
search.value = 'кв. № 20'; await search.trigger('input'); assert.equal(flatList.querySelectorAll('input').length, 1);
assert.equal(flatList.querySelectorAll('input')[0].dataset.key, '11013930:20');
const saves = host.querySelectorAll('button').filter(button => button.textContent === 'Сохранить настройки');
assert.equal(saves.length, 1, 'Одна панель сохранения внизу');
allowed = false; ui.refresh(); assert.equal(saves[0].disabled, true);
await saves[0].trigger('click'); assert.equal(requests.length, 1, 'Черновики инструментов блокируют POST');
allowed = true;
caps[0].value = ''; await caps[0].trigger('input'); await saves[0].trigger('click');
assert.equal(caps[0].reported, true); assert.equal(requests.length, 1, 'Пустое обязательное поле не сохраняется');
caps[0].value = '12.5'; await caps[0].trigger('input');
apiError = 'Конфликт версии'; await saves[0].trigger('click'); assert.equal(ui.isDirty(), true);
apiError = undefined;
await saves[0].trigger('click');
assert.equal(ui.isDirty(), false); assert.equal(accepted.length, 1);
assert.equal(requests.at(-1).body.revision, 'fresh');
assert.deepEqual(requests.at(-1).body.settings, { moneyCost: {da1:0, da2:.5, dnk2:.12375}, subsidyCompensation: { da1: .125, da2: .1, dnk2: .1 }, specialFlats: ['6871059:1', '999:retired'] });
assert.ok(host.querySelectorAll('p').some(node => /Публикация не завершена/.test(node.textContent)));
assert.deepEqual(clone(context.window.SM_DATA.settings.specialFlats), ['6871059:1', '999:retired']);

// Черновик настроек переживает перерисовку/принятие новой версии каталога.
caps[1].value = '7'; await caps[1].trigger('input');
data = { revision: 'another', settings: clone(settings) }; ui.refresh(); assert.equal(caps[1].value, '7');
let finishPost;
nextPost = new Promise(resolve => { finishPost = resolve; });
const saving = saves[0].trigger('click');
assert.equal(ui.isBusy(), true);
allowed = false;
finishPost({ data: { revision: 'concurrent', settings: clone(requests.at(-1).body.settings) }, published: true });
await saving;
assert.equal(ui.isBusy(), false); assert.equal(ui.isDirty(), false);
assert.equal(accepted.length, 1, 'Черновики инструментов, появившиеся во время POST, не стираются через accepted');
assert.ok(host.querySelectorAll('p').some(node => /Черновики инструментов сохранены на экране/.test(node.textContent)));
ui.refresh(); assert.equal(caps[1].value, '7', 'После POST устаревшая версия основного редактора не откатывает сохранённые настройки');
ui.destroy(); assert.equal(host.removed, true);
console.log('Настройки: свежая версия, обязательные лимиты, все квартиры, поиск/фильтр, сохранение, ошибки и конкурентные черновики — проверены');
