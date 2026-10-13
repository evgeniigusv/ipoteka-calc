// Проверка расчётов: node tests/engine.test.mjs
// Эталон по ипотеке — пример из таблицы «Калькулятор ЧПВ», лист «Калькурятор субсидий».
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

const DA1 = 'ДА — 1 очередь', DA2 = 'ДА — 2 очередь';
const sber129 = rows => rows.find(x => x.name === 'Сниженная ставка на весь срок (Сбер)' && x.r1 === 0.129);

test('данные читаются: 2 очереди, 3 типа ипотеки, скидка 13%', () => {
  assert.deepEqual(D.projects, [DA1, DA2]);
  assert.deepEqual(D.types, ['Семейная ипотека', 'IT-ипотека', 'Стандартная ипотека']);
  assert.equal(D.defaultDiscount, 0.13);
  assert.equal(D.programs.length, 8);
  assert.equal(D.installments.length, 4);
  D.programs.forEach(p => { assert.equal(p.minPv, 0.201); assert.ok(p.r1 > 0 && p.sub >= 0 && p.maxTerm >= 15); });
  assert.deepEqual(C.kidsOptions(D, DA1, 'Семейная ипотека'), []);
});

test('аннуитет совпадает с таблицей: 4 218 000 под 12,9% на 30 лет = 46 330,04', () => {
  near(C.pmt(0.129 / 12, 360, 4218000), 46330.04, 0.01);
  near(C.pmt(0.195 / 12, 360, 4218000), 68750.03, 0.01);
});

// Таблица: прайс 6 218 000, со скидкой 5 410 000, Сбер 12,9% / комиссия 14,5%.
// В равновесии «ПВ клиента» = «Необходимое ПВ»: ПВ = 0,201·(s·B + D) / (1 + 0,201·s) — та же формула, что в боте.
test('субсидированная программа: ПВ, субсидия и цена — как в «Калькуляторе ЧПВ»', () => {
  const B = 6218000, Dp = 5410000, s = 0.145, m = 0.201;
  const pv = m * (s * B + Dp) / (1 + m * s), subsidy = (B - pv) * s, ddu = Dp + subsidy;
  const r = sber129(C.mortgage(D, { project: DA1, type: 'Стандартная ипотека', base: B, disc: 1 - Dp / B }).rows);
  assert.ok(r.ok);
  near(r.pv, pv, 1);
  near(r.subsidy, subsidy, 1);
  near(r.price, ddu, 1);
  near(r.minPvRub, r.price * m, 1);
  assert.equal(r.loan, r.price - r.pv);
  assert.ok(r.surplus > 0);
});

test('ПВ клиента 2 000 000 — цифры ячеек таблицы: субсидия 611 610, цена 6 021 610, профицит 196 390', () => {
  const inp = { project: DA1, type: 'Стандартная ипотека', base: 6218000, disc: 1 - 5410000 / 6218000, pv: 2000000 };
  const r = sber129(C.mortgage(D, inp).rows);
  near(r.subsidy, 611610, 0.5);
  near(r.price, 6021610, 0.5);
  near(r.surplus, 196390, 0.5);
  assert.equal(r.pv, 2000000);
  // с настройкой loanFromBase платёж — как в таблице (кредит = прайс − ПВ)
  near(sber129(C.mortgage(D, inp, { loanFromBase: true }).rows).pay1, 46330.04, 0.01);
});

test('без субсидии цена = прайс минус скидка, ПВ 20,1%', () => {
  const res = C.mortgage(D, { project: DA2, type: 'Стандартная ипотека', base: 10000000, disc: 0.13 });
  const r = res.rows.find(x => x.name === 'Рыночная ставка, без субсидии');
  assert.equal(r.price, 8700000);
  assert.equal(r.pv, 1748700);
  assert.equal(r.loan, 6951300);
  near(r.pay1, C.pmt(0.195 / 12, 360, 6951300), 0.01);
});

test('лимит кредита: семейная — не больше 6 млн, взнос растёт; IT — не больше 9 млн', () => {
  const fam = C.mortgage(D, { project: DA1, type: 'Семейная ипотека', base: 10000000, disc: 0.13 });
  assert.equal(fam.rows.length, 2);
  fam.rows.forEach(r => {
    assert.ok(r.ok);
    assert.equal(r.loan, 6000000);
    assert.ok(r.pvShare > 0.201);
    assert.match(r.note, /не больше 6\s000\s000/);
    near(r.pay1, C.pmt(0.035 / 12, 360, 6000000), 0.01);
  });
  const it = C.mortgage(D, { project: DA1, type: 'IT-ипотека', base: 14000000, disc: 0.13 });
  it.rows.forEach(r => assert.equal(r.loan, 9000000));
  const small = C.mortgage(D, { project: DA1, type: 'IT-ипотека', base: 8000000, disc: 0.13 });
  small.rows.forEach(r => { assert.ok(r.loan < 9000000); near(r.pvShare, 0.201, 1e-6); assert.equal(r.note, ''); });
});

test('субсидия больше скидки — программа не подходит, подсказана нужная скидка', () => {
  const inp = { project: DA1, type: 'Стандартная ипотека', base: 10000000, disc: 0.05 };
  const res = C.mortgage(D, inp);
  const bad = sber129(res.rows);
  assert.equal(bad.status, 'Субсидия больше скидки');
  assert.equal(bad.note, 'Доступна при скидке от 11,6%');
  assert.ok(sber129(C.mortgage(D, { ...inp, disc: 0.116 }).rows).ok);
  assert.ok(!sber129(C.mortgage(D, { ...inp, disc: 0.115 }).rows).ok);
  assert.equal(res.best.name, 'Рыночная ставка, без субсидии');
  assert.ok(res.rows.at(-1).ok === false, 'неподходящие — в конце списка');
});

test('автоподбор: наименьший платёж среди программ с наименьшим взносом; ручной выбор сохраняется', () => {
  const inp = { project: DA1, type: 'Стандартная ипотека', base: 10000000, disc: 0.13 };
  const res = C.mortgage(D, inp);
  assert.equal(res.best.r1, 0.129, 'Совкомбанк на 15 лет платит больше в месяц, хоть ставка и ниже');
  const pick = res.rows.find(x => x.r1 === 0.139).id;
  const res2 = C.mortgage(D, { ...inp, pick });
  assert.equal(res2.best.id, pick);
  assert.ok(res2.picked);
});

test('срок: Совкомбанк на 15 лет не считается на 30; введённый срок 10 лет применяется ко всем', () => {
  const inp = { project: DA1, type: 'Стандартная ипотека', base: 10000000, disc: 0.13 };
  const r = C.mortgage(D, { ...inp, term: 30 }).rows.find(x => x.r1 === 0.1249);
  assert.equal(r.term, 15);
  near(r.pay1, C.pmt(0.1249 / 12, 180, r.loan), 0.01);
  assert.equal(r.note, 'Срок уменьшен до максимального по программе');
  C.mortgage(D, { ...inp, term: 10 }).rows.forEach(x => assert.equal(x.term, 10));
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

test('рассрочка от 30%, ДА-2: скидка от суммы взноса, равные платежи до 05.07.2028', () => {
  const cards = C.installments(D, { project: DA2, base: 10000000, rooms: 1, extra: 0 }, today);
  assert.deepEqual(cards.map(c => c.name), ['Рассрочка от 30%', 'Рассрочка с ежемесячным платежом']);
  const c = cards[0];
  near(c.disc, 0.039, 1e-9);
  assert.equal(c.total, 9610000);
  assert.equal(c.rows[0].amount, 2883000);
  assert.equal(c.termMonths, 20);
  near(c.payment, (9610000 - 2883000) / 20, 0.01);
  const half = C.installments(D, { project: DA2, base: 10000000, rooms: 1, extra: 0, pv: { [c.id]: 0.5 }, step: { [c.id]: 3 } }, today)[0];
  near(half.disc, 0.065, 1e-9);
  near(half.payment, (half.total - half.rows[0].amount) / 6, 0.01);
  const big = C.installments(D, { project: DA2, base: 10000000, rooms: 1, extra: 0, pv: { [c.id]: 0.7 } }, today)[0];
  near(big.disc, 0.07, 1e-9);
  const extra = C.installments(D, { project: DA2, base: 10000000, rooms: 1, extra: 0.01 }, today)[0];
  assert.equal(extra.total, 9510000);
});

test('рассрочка с ежемесячным платежом: ДА-1 до 01.03.2027 — 4 платежа, скидка 6%; ДА-2 — 20 платежей без скидки', () => {
  const c = C.installments(D, { project: DA1, base: 10000000, rooms: 2, extra: 0 }, today)[1];
  assert.equal(c.total, 9400000);
  assert.equal(c.rows[0].amount, 940000);
  assert.equal(c.rows[1].amount, 75000 * 4);
  assert.equal(c.rows[2].amount, 9400000 - 940000 - 300000);
  assert.equal(c.rows.reduce((s, r) => s + r.amount, 0), c.total);
  const c2 = C.installments(D, { project: DA2, base: 10000000, rooms: 3, extra: 0 }, today)[1];
  assert.equal(c2.total, 10000000);
  assert.equal(c2.rows[1].amount, 100000 * 20);
  assert.equal(c2.rows.reduce((s, r) => s + r.amount, 0), c2.total);
});

console.log(`\nвсе проверки пройдены: ${n}`);
