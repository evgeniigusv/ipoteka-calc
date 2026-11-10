import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
globalThis.window=globalThis;for(const name of ['data','engine'])vm.runInThisContext(fs.readFileSync('assets/'+name+'.js','utf8'));
const D=SMCalc.buildData(SM_DATA),input={project:'ДА — 1 очередь',base:10000000,rooms:1,extra:0};
// Истёкшее предложение одинаково блокирует все четыре механики, даже с будущим погашением.
for(const scheme of ['equal','monthly','deferred','scheduled']){
 const raw={projects:['Тест'],installments:[{name:'Тест',scheme,minPv:.2,months:6,steps:[1],pay:{1:50000},validUntil:'2026-11-10'}]};
 const data=SMCalc.buildData(raw),inp={...input,project:'Тест'};
 const lastDay=SMCalc.installments(data,inp,new Date(2026,10,10))[0];assert.ok(!lastDay.error);assert.ok(lastDay.rows.length);
 const expired=SMCalc.installments(data,inp,new Date(2026,10,11))[0];assert.match(expired.error,/Срок действия программы истёк 10.11.2026/);assert.deepEqual(expired.rows,[]);
}
for(const project of ['ДА — 1 очередь','ДА — 2 очередь']){
 const cards=SMCalc.installments(D,{...input,project},new Date(2026,10,10));
 assert.ok(cards.every(c=>c.error&&c.rows.length===0));assert.ok(cards.filter(c=>c.name.includes('родителей')).every(c=>c.error.includes('30.07.2026')));
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
