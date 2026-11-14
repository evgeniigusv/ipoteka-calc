// Проверка расчётов: node tests/engine.test.mjs
// Эталон по ипотеке — таблица «Калькулятор ЧПВ», лист «Калькулятор субсидирования»:
// квартира с ценой за наличку 12 515 000 и по прайсу 14 385 057, ПВ 20,1% (цифры блока «Сравнение всех программ»).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dir = new URL('../assets/', import.meta.url);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(new URL('data.js', dir), 'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('engine.js', dir), 'utf8'));
const C = globalThis.SMCalc;
const D = C.buildData(globalThis.SM_DATA);
const today = new Date(2026, 9, 13);
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok —', name); };

const DA1 = 'ДА — 1 очередь', DA2 = 'ДА — 2 очередь', FAMILY = 'Семейная ипотека', BASE = 'Базовая ипотека';
const SHEET = { project: DA1, base: 14385057, disc: 1 - 12515000 / 14385057 };
const find = (rows, name, term, rate) => rows.find(r => r.name === name && r.term === term && (rate == null || r.r1 === rate));

test('данные читаются: 3 очереди, 2 типа ипотеки, 53 программы, скидка 13%', () => {
  assert.deepEqual(D.projects, [DA1, DA2, 'ДНК — 2 очередь']);
  assert.equal(C.mortgage(D, {project: 'ДНК — 2 очередь', type: BASE, base: 10000000, disc: 0.13}).rows.length, 6);
  assert.equal(C.installments(D, {project: 'ДНК — 2 очередь', base: 10000000, rooms: 1, extra: 0, pv: {}, step: {}}).length, 5);
  assert.deepEqual(D.types, [FAMILY, BASE]);
  assert.equal(D.defaultDiscount, 0.13);
  assert.equal(D.programs.length, 53);
  assert.equal(D.installments.length, 9);
  D.programs.forEach(p => { assert.equal(p.minPv, p.projects[0]==='ДНК — 2 очередь' ? .2 : .201); assert.ok(p.r1 > 0 && p.sub >= 0 && p.maxTerm >= 10 && p.name); });
  assert.deepEqual(C.kidsOptions(D, DA1, FAMILY), ['1 ребёнок', '2 ребёнка', '3 ребёнка', '4 ребёнка', '5 и более детей']);
  assert.deepEqual(C.kidsOptions(D, DA1, BASE), []);
  const lim = k => [...new Set(D.programs.filter(p => p.kids === k).map(p => p.limit))];
  assert.deepEqual(lim('1 ребёнок'), [6000000]);
  assert.deepEqual(lim('2 ребёнка'), [8000000]);
  assert.deepEqual(lim('3 ребёнка'), [10000000]);
  D.programs.filter(p => p.type === BASE).forEach(p => assert.equal(p.limit, Infinity));
});

test('базовая ипотека: комиссия, цена и профит — как в «Калькуляторе субсидирования»', () => {
  const rows = C.mortgage(D, { ...SHEET, type: BASE }).rows;
  assert.equal(rows.length, 10);
  // [программа, срок, комиссия банку, цена реализации, профит]
  [
    ['ДОМ.РФ, стандартная ставка', 30, 0, 12515000, 1870057],
    ['ДОМ.РФ, субсидированная ставка', 30, 1752783, 14267783, 117274],
    ['Альфа-Банк, субсидированная ставка', 10, 1066612, 13581612, 803446],
    ['Альфа-Банк, субсидированная ставка', 15, 1467740, 13982740, 402317],
    ['Альфа-Банк, субсидированная ставка', 20, 1795310, 14310310, 74748],
    ['Альфа-Банк, субсидированная ставка', 30, 1753933, 14268933, 116125],
    ['Сбербанк, субсидированная ставка', 30, 1781517, 14296517, 88540]
  ].forEach(([name, term, fee, price, profit]) => {
    const r = find(rows, name, term);
    assert.ok(r.ok, name);
    assert.equal(r.pv, 2891397);                 // «ПВ, руб.» при 20,1%
    near(r.subsidy, fee); near(r.price, price); near(r.surplus, profit);
    assert.equal(r.loan, r.price - r.pv);        // кредит — от цены в договоре
  });
});

test('с настройкой loanFromBase кредит и платёж — как в таблице (от цены по прайсу)', () => {
  const rows = C.mortgage(D, { ...SHEET, type: BASE }, { loanFromBase: true }).rows;
  [
    ['ДОМ.РФ, стандартная ставка', 30, 180738], ['ДОМ.РФ, субсидированная ставка', 30, 128942],
    ['Альфа-Банк, субсидированная ставка', 10, 168173], ['Альфа-Банк, субсидированная ставка', 15, 141587],
    ['Альфа-Банк, субсидированная ставка', 20, 130503], ['Альфа-Банк, субсидированная ставка', 30, 122578],
    ['Сбербанк, субсидированная ставка', 30, 127143]
  ].forEach(([name, term, pay]) => {
    const r = find(rows, name, term);
    near(r.loan, 11493661);
    near(r.pay1, pay);
  });
});

test('лимит кредита: ДОМ.РФ, 3 ребёнка — «нужен ПВ от 30,5%», как в вердикте таблицы', () => {
  const rows = C.mortgage(D, { ...SHEET, type: FAMILY, kids: '3 ребёнка' }).rows;
  assert.deepEqual(rows.map(r => r.name).sort(), ['ДОМ.РФ', 'Сбербанк']);
  const r = find(rows, 'ДОМ.РФ', 15);
  assert.equal(r.pv, 14385057 - 10000000);
  assert.equal(C.fmt.pct1(r.pvShare), '30,5%');
  near(r.subsidy, 10000000 * 0.1295);
  assert.equal(r.price, 12515000 + 1295000);
  assert.match(r.note, /не больше 10\s000\s000/);
});

test('семейная без упора в лимит: взнос 20,1% от прайса, платёж на срок программы', () => {
  const res = C.mortgage(D, { project: DA1, type: FAMILY, kids: '1 ребёнок', base: 7000000, disc: 0.13 });
  assert.equal(res.rows.length, 8);
  const r = find(res.rows, 'ДОМ.РФ', 15);
  assert.equal(r.pv, 1407000);
  near(r.subsidy, 5593000 * 0.1516);
  assert.equal(r.price, 6090000 + 847899);
  assert.equal(r.note, '');
  near(r.pay1, C.pmt(0.07 / 12, 180, r.price - r.pv), 0.01);
  // комиссия 17–21% при скидке 13% не проходит: подсказана нужная скидка
  const vtb = find(res.rows, 'Альфа-Банк', 15, 0.06);
  assert.equal(vtb.status, 'Субсидия больше скидки');
  assert.equal(vtb.note, 'Доступна при скидке от 14,2%');
  assert.ok(find(C.mortgage(D, { project: DA1, type: FAMILY, kids: '1 ребёнок', base: 7000000, disc: 0.142 }).rows, 'Альфа-Банк', 15, 0.06).ok);
  assert.ok(res.rows.at(-1).ok === false, 'неподходящие — в конце списка');
});

test('число детей отбирает программы: для пятерых — только Сбербанк', () => {
  const rows = C.mortgage(D, { project: DA1, type: FAMILY, kids: '5 и более детей', base: 9000000, disc: 0.13 }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Сбербанк');
  assert.equal(rows[0].r1, 0.006);
});

test('автоподбор: наименьший платёж среди подходящих; ручной выбор сохраняется', () => {
  const inp = { project: DA1, type: BASE, base: 10000000, disc: 0.13 };
  const res = C.mortgage(D, inp);
  const ok = res.rows.filter(r => r.ok);
  assert.equal(res.best.pay1, Math.min(...ok.map(r => r.pay1)));
  const pick = ok.at(-1).id;
  const res2 = C.mortgage(D, { ...inp, pick });
  assert.equal(res2.best.id, pick);
  assert.ok(res2.picked);
});

test('срок: программа на 10 лет не считается на 30; введённый срок короче — применяется', () => {
  const inp = { project: DA1, type: BASE, base: 10000000, disc: 0.13 };
  const r = find(C.mortgage(D, { ...inp, term: 30 }).rows, 'Альфа-Банк, субсидированная ставка', 10);
  near(r.pay1, C.pmt(0.1249 / 12, 120, r.loan), 0.01);
  assert.equal(r.note, 'Срок уменьшен до максимального по программе');
  C.mortgage(D, { ...inp, term: 7 }).rows.forEach(x => assert.equal(x.term, 7));
});

test('свой взнос больше минимального: комиссия считается от меньшего кредита', () => {
  const r = find(C.mortgage(D, { ...SHEET, type: BASE, pv: 5000000 }).rows, 'Сбербанк, субсидированная ставка', 30);
  assert.equal(r.pv, 5000000);
  near(r.subsidy, (14385057 - 5000000) * 0.155);
  assert.equal(r.loan, r.price - 5000000);
});

test('льготный период: платёж пересчитывается на остаток по основной ставке', () => {
  const G = C.buildData({ minPv: 0.201, mortgage: [{ type: 'T', name: 'На 2 года', rate: 0.01, rateAfter: 0.195, graceYears: 2, subsidy: 0 }] });
  const r = C.mortgage(G, { project: 'x', type: 'T', base: 10000000, disc: 0 }).rows[0];
  assert.equal(r.graceMonths, 24);
  assert.ok(r.pay2 > r.pay1 * 3);
  near(r.total, r.pay1 * 24 + r.pay2 * 336, 1);
  // остаток после льготного периода гасится ровно за оставшийся срок
  let bal = r.loan;
  for (let i = 0; i < 24; i++) bal = bal * (1 + 0.01 / 12) - r.pay1;
  for (let i = 0; i < 336; i++) bal = bal * (1 + 0.195 / 12) - r.pay2;
  near(bal, 0, 1);
});

test('ДА-2 от 30% сохраняет скидку от всей цены при изменении взноса', () => {
  const input = { project: DA2, base: 10000000, rooms: 1, extra: 0 };
  const date = new Date(2026, 10, 14);
  const [equal] = C.installments(D, input, date);
  for (const share of [.3, .5, .7]) {
    const [card] = C.installments(D, { ...input, pv: { [equal.id]: share }, step: { [equal.id]: 3 } }, date);
    assert.equal(card.disc, .1);
    assert.equal(card.total, 9000000);
    assert.equal(card.rows[0].amount, input.base * share);
    assert.equal(C.fmt.dmy(card.end), '07.11.2028');
    assert.equal(card.payment, Math.floor((card.total - card.rows[0].amount) / 8));
  }
  const [extra] = C.installments(D, { ...input, extra: .01 }, date);
  assert.equal(extra.total, 8900000);
});

test('ежемесячная рассрочка ДА учитывает скидку очереди и платёж по комнатности', () => {
  const date = new Date(2026, 10, 14);
  for (const [project, total, end, count] of [
    [DA1, 9000000, '01.03.2027', 3],
    [DA2, 9700000, '01.09.2028', 21]
  ]) {
    for (const [rooms, payment] of [[1, 30000], [2, 60000], [3, 90000]]) {
      const [, card] = C.installments(D, { project, base: 10000000, rooms }, date);
      assert.equal(card.total, total);
      assert.equal(C.fmt.dmy(card.end), end);
      assert.equal(card.payment, payment);
      assert.deepEqual(card.rows.map(r => r.amount), [total / 10, payment * count, total - total / 10 - payment * count]);
    }
  }
});

console.log(`\nвсе проверки пройдены: ${n}`);
