import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
globalThis.window=globalThis;for(const name of ['data','engine'])vm.runInThisContext(fs.readFileSync('assets/'+name+'.js','utf8'));
const D=SMCalc.buildData(SM_DATA),input={project:'ДА — 1 очередь',base:10000000,rooms:1,extra:0};
// Дата в справочнике меняет только примечание. Дата погашения ограничивает график.
for (const scheme of ['equal', 'monthly', 'deferred', 'scheduled']) {
  const data = SMCalc.buildData({projects: ['Тест'], installments: [{
    name: 'Тест', scheme, minPv: .2, end: '2027-03-20',
    steps: [1], pay: {1: 50000}, validUntil: '2026-11-10'
  }]});
  const calc = date => SMCalc.installments(data, {...input, project: 'Тест'}, date)[0];
  assert.equal(calc(new Date(2026, 10, 10)).warning, '');
  const next = calc(new Date(2026, 10, 11));
  assert.match(next.warning, /10.11.2026/);
  assert.ok(!next.error);
  assert.equal(next.rows.reduce((sum, row) => sum + row.amount, 0), next.total);
  for (const day of [20, 21]) {
    const closed = calc(new Date(2027, 2, day));
    assert.match(closed.error, /Срок погашения/);
    assert.deepEqual(closed.rows, []);
  }
}
for (const project of ['ДА — 1 очередь', 'ДА — 2 очередь']) {
  const cards = SMCalc.installments(D, {...input, project}, new Date(2026, 10, 11));
  assert.equal(cards.length, 4);
  for (const card of cards) {
    assert.ok(!card.error, card.name);
    assert.ok(card.rows.length >= 2);
    assert.equal(card.rows.reduce((sum, row) => sum + row.amount, 0), card.total);
  }
  const parents = cards.filter(card => card.name.includes('родителей'));
  assert.deepEqual(parents.map(card => SMCalc.fmt.dmy(card.end)), ['11.02.2027', '11.05.2027']);
}
const dnk={...input,project:'ДНК — 2 очередь'},date=new Date(2026,10,10);
const half=SMCalc.installments(D,dnk,date).find(c=>c.name==='Рассрочка 50/50');
for(const [share,discount,total,down] of [[.5,.12,8800000,4400000],[.7,.14,8600000,6020000],[.5,.12,8800000,4400000]]){
 const c=SMCalc.installments(D,{...dnk,pv:{[half.id]:share}},date).find(c=>c.id===half.id);
 assert.ok(Math.abs(c.disc-discount)<1e-10);assert.equal(c.total,total);assert.equal(c.rows[0].amount,down);assert.equal(c.rows.reduce((s,r)=>s+r.amount,0),total);
}
for(const [share,discount] of [[.5,.1],[.7,.12]]){const c=SMCalc.installments(D,{...dnk,pv:{[half.id]:share}},new Date(2026,11,1)).find(c=>c.id===half.id);assert.equal(c.disc,discount);assert.equal(c.launchDisc,0);}
const future=SMCalc.installments(D,input,new Date(2027,3,1))[0];assert.match(future.error,/Срок погашения уже прошёл/);
console.log('ПВ 50→70→50, окончание стартовой акции, четыре механики и будущие родители: проверено.');

// Один и тот же бюджет проверяется по каждому проекту и механике без округления до кнопки ПВ.
const dealDate=new Date(2026,10,12);
function manual(project,name,downRub,extra=0){
 const card=SMCalc.installments(D,{project,base:10000000,rooms:1,downRub,extra},dealDate).find(c=>c.name===name);
 if(!card.error){
  assert.equal(card.rows[0].amount,downRub);
  assert.equal(card.rows.reduce((s,r)=>s+r.amount,0),card.total);
 }
 return card;
}
for(const project of ['ДА — 1 очередь','ДА — 2 очередь']){
 const equal=manual(project,'Рассрочка от 30%',4150000);
 assert.equal(equal.total,9460500); // 13% от фактических 4 150 000 ₽.
 assert.match(manual(project,'Рассрочка от 30%',1700000).error,/Не хватает/);
 assert.ok(!manual(project,'Рассрочка с ежемесячным платежом',1700000).error);
}
assert.equal(manual('ДА — 1 очередь','Рассрочка от 30%',6000000,.02).total,9020000);
assert.match(manual('ДА — 1 очередь','Для будущих родителей · 6 мес.',11000000).error,/превышает/);
assert.equal(manual('ДНК — 2 очередь','Рассрочка 50/50',6020000).total,8600000);
assert.match(manual('ДНК — 2 очередь','Рассрочка 50/50',5500000).error,/50%/);
assert.ok(!manual('ДНК — 2 очередь','Без первоначального взноса',0).error);
assert.match(manual('ДНК — 2 очередь','Рассрочка 4/25',3000000).error,/25%/);
