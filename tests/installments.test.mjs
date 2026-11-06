import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
globalThis.window=globalThis;
for(const file of ['data','engine'])vm.runInThisContext(fs.readFileSync(new URL('../assets/'+file+'.js',import.meta.url),'utf8'));
const D=SMCalc.buildData(SM_DATA),project='ДА — 1 очередь';
const input={project,base:10000000,rooms:1,extra:0};
// Четыре платёжных месяца: декабрь, январь, февраль и погашение в марте.
for(const day of [1,6,20,30]) {
 const c=SMCalc.installments(D,input,new Date(2026,10,day))[0];
 assert.equal(c.total,9610000);assert.equal(c.rows[0].amount,3000000);
 assert.equal(c.payment,1652500);
 assert.deepEqual(c.rows.map(r=>r.amount),[3000000,4957500,1652500]);
}
let c=SMCalc.installments(D,input,new Date(2027,2,6))[0];
assert.deepEqual(c.rows.map(r=>r.amount),[3000000,6610000]);
assert.ok(SMCalc.installments(D,input,new Date(2027,2,20))[0].error);
c=SMCalc.installments(D,{...input,step:{1:3}},new Date(2026,10,6))[0];
assert.deepEqual(c.rows.map(r=>r.amount),[3000000,3305000,3305000]);
const da2=SMCalc.installments(D,{...input,project:'ДА — 2 очередь'},new Date(2026,10,6))[0];
assert.equal(da2.payment,Math.floor(6610000/24));
assert.equal(da2.rows.reduce((a,r)=>a+r.amount,0),9610000);
console.log('Рассрочка: количество платёжных месяцев, последний платёж, квартал и 24 месяца — проверены');
