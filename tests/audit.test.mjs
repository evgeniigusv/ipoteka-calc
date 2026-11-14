import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
globalThis.window=globalThis;
for(const file of ['data','engine','common','transh-engine'])vm.runInThisContext(fs.readFileSync(new URL('../assets/'+file+'.js',import.meta.url),'utf8'));
const C=SMCalc,D=C.buildData(SM_DATA),now=new Date(2026,10,6),dnk='ДНК — 2 очередь';
assert.equal(D.programs.filter(p=>p.projects.includes(dnk)).length,23);
assert.equal(D.programs.filter(p=>p.projects.includes('ДА — 1 очередь')).length,30);
// Independent amortization: every payment stream must close the actual loan.
for(const project of D.projects)for(const type of D.types)for(const kids of [null,...C.kidsOptions(D,project,type)]) {
 const rows=C.mortgage(D,{project,type,kids,base:12345678,disc:.19,pv:3000000}).rows;
 for(const r of rows.filter(r=>r.ok)){assert.equal(r.pv+r.loan,r.price);let balance=r.loan;for(let m=0;m<r.term*12;m++)balance=balance*(1+r.r1/12)-r.pay1;assert.ok(Math.abs(balance)<.1);}
}
const input={project:dnk,base:10000000,rooms:1,extra:0};
let cards=C.installments(D,input,now);
const quarter=cards.find(c=>c.name==='Рассрочка 4/25');
assert.equal(quarter.total,9100000);assert.deepEqual(quarter.rows.map(r=>r.amount),[2275000,2275000,2275000,2275000]);
const monthly=cards.find(c=>c.name==='Рассрочка 20/20');
assert.equal(monthly.total,9400000);assert.deepEqual(monthly.rows.map(r=>r.amount),[1880000,500000,470000,6550000]);
const zero=cards[0];assert.deepEqual(zero.rows.map(r=>r.amount),[0,1250000,1000000,500000,7250000]);
assert.equal(C.installments(D,{...input,extra:.02},now)[0].total,10000000);
const december=C.installments(D,input,new Date(2026,11,1));assert.equal(december.find(c=>c.name==='Рассрочка 4/25').total,9300000);
const half=cards.find(c=>c.name==='Рассрочка 50/50');
const seventy=C.installments(D,{...input,pv:{[half.id]:.7}},now).find(c=>c.id===half.id);
assert.equal(seventy.total,8600000);assert.deepEqual(seventy.rows.map(r=>r.amount),[6020000,430000,2150000]);
for(const project of D.projects)for(const price of [100000,6000000,10000000,30000000])for(const date of [now,new Date(2026,10,30),new Date(2026,11,1),new Date(2028,10,1),new Date(2030,0,1)]) {
 for(const c of C.installments(D,{project,base:price,rooms:3,extra:.01},date)){
  if(c.error){assert.equal(c.rows.length,0);continue;}
  assert.ok(c.rows.every(r=>Number.isFinite(r.amount)&&r.amount>=0));assert.equal(c.rows.reduce((a,r)=>a+r.amount,0),c.total);
 }
}
const da=C.installments(D,{project:'ДА — 2 очередь',base:10000000,rooms:1,extra:0},now)[0];
assert.equal(da.end.getFullYear(),2028);assert.equal(da.end.getMonth(),10);assert.equal(da.end.getDate(),7);assert.equal(da.saved,1000000);
assert.ok(C.installments(D,{project:'ДА — 1 очередь',base:10000000,rooms:1},new Date(2027,3,1))[0].error);
for(const [v,expected] of [['10 000 000,00 ₽',10000000],['7 123 456.50',7123457],['-500000',null],['1e6',null],['',null]])assert.equal(SMUi.parseMoney(v),expected);
const tr={price:10000000,down:.2,rate:.192,years:30,first:.2,second:.2,date1:'2026-11-06',date2:'2027-11-06',date3:'2029-05-01'};
assert.throws(()=>SMTranshCalc.calculate({...tr,date2:'2027-02-30'}),/даты/);
assert.throws(()=>SMTranshCalc.calculate({...tr,price:Infinity}),/стоимость/);
console.log('Аудит: 53 ипотечные программы, амортизация, 9 рассрочек, баланс всех графиков, даты, акция и денежный ввод — проверены');
