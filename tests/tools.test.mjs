import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import M from '../assets/tools-model.js';
M.validate(JSON.parse(fs.readFileSync(new URL('../assets/tools.json',import.meta.url))));
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/tools-initial.json',import.meta.url)));
M.validate(data);
const ctx={window:{},console,Intl,Date};vm.createContext(ctx);for(const file of ['data.js','engine.js','transh-engine.js','chpv-engine.js']){if(fs.existsSync('assets/'+file))vm.runInContext(fs.readFileSync('assets/'+file,'utf8'),ctx);}
// Первоначальный справочник сравниваем с резервом тех же условий.
const historicalDa=JSON.parse(fs.readFileSync(new URL('./fixtures/installments-october.json',import.meta.url))).programs;
const dnk=ctx.window.SM_DATA.installments.filter(p=>p.projects.includes('ДНК — 2 очередь'));
const before=ctx.window.SMCalc.buildData({...ctx.window.SM_DATA,installments:[...historicalDa,...dnk]});
const mapped=M.calcData(data);const after=ctx.window.SMCalc.buildData({...ctx.window.SM_DATA,...mapped});
const plain=v=>JSON.parse(JSON.stringify(v));
for(const project of Object.values(M.projects)){
 const input={project,base:10000000,disc:.13,pv:2010000,extraPct:0,extraRub:0,rooms:2,picks:{},shares:{},steps:{}};
 const old=plain(ctx.window.SMCalc.installments(before,input,new Date(2026,10,6)));
 const fresh=plain(ctx.window.SMCalc.installments(after,input,new Date(2026,10,6)));
 assert.equal(fresh.length,old.length,project);
 fresh.forEach((r,i)=>{assert.equal(r.total,old[i].total,project+' '+r.name);assert.deepEqual(r.rows,old[i].rows);});
}
const changed=M.clone(data),first=changed.records.find(r=>r.kind==='mortgage');first.params.rate=.01;assert.equal(M.calcData(changed).mortgage[0].rate,.01);
const sample=M.clone(data.records.find(r=>r.kind==='installment'));sample.id='test-new';sample.group='test-new';sample.name='Новая рассрочка';sample.params={scheme:'deferred',minPv:.4,months:6,disc:.02};changed.records.push(sample);
const added=ctx.window.SMCalc.buildData({...ctx.window.SM_DATA,...M.calcData(changed)});assert.equal(added.installments.length,after.installments.length+1);
const invalid=M.clone(data);invalid.records[0].params.rate=120;assert.throws(()=>M.validate(invalid));
invalid.records[0].params.rate=.1;invalid.records[0].params.evil='x';assert.throws(()=>M.validate(invalid));
const wrong=M.clone(sample);wrong.params.end='2027-02-30';assert.throws(()=>M.validateRecord(wrong));wrong.params.end='2027-02-28';assert.throws(()=>M.validateRecord(wrong));
wrong.params={scheme:'scheduled',minPv:.6,months:12,milestones:[{share:.5,months:3}]};assert.throws(()=>M.validateRecord(wrong));
const mode=M.clone(data);const inst=mode.records.find(r=>r.kind==='installment');inst.mode='none';assert.equal(M.calcData(mode).installments[0].noExtra,true);inst.mode='sequential';assert.equal(M.calcData(mode).installments[0].extraSequential,true);
console.log('Справочник: все прежние рассрочки совпадают; новая программа, ставки, сочетания и ошибочные параметры проверены.');

const live=JSON.parse(fs.readFileSync(new URL('../assets/tools.json',import.meta.url)));
const sections=Object.keys(M.categories);
assert.deepEqual(sections.slice(0,4),['mortgage','installment','tranche','chpv']);
for(const snapshot of [live,data]){
 const tranches=snapshot.records.filter(r=>r.kind==='tranche');
 assert.ok(tranches.length);
 const groups=M.groups(snapshot);
 assert.deepEqual(groups.filter(g=>g.category==='tranche').flatMap(g=>Object.values(g.cells).flat()).map(r=>r.id).sort(),
                  tranches.map(r=>r.id).sort());
 for(const row of tranches){
  M.validateRecord({...row,category:'tranche'});
  assert.throws(()=>M.validateRecord({...row,category:'extra'}));
 }
}
assert.deepEqual(Object.keys(M.mortgageTypes),['base','family1','family2','family3','family4','family5','it']);
const types=live.records.filter(r=>r.kind==='mortgage').map(r=>M.mortgageType(r.params));
assert.ok(types.every(Boolean));
assert.equal(M.mortgageType({type:'Семейная ипотека'}),null);
assert.equal(M.mortgageType({type:'Семейная ипотека',kids:'5 и более детей'}),'family5');
assert.equal(M.mortgageType({type:'IT-ипотека'}),'it');
const info={kind:'info',name:'Субсидированная IT-ипотека',params:{},description:
 'Банки: Сбер\nПВ - от 20%\nСтавка:\n* 3,5% на весь срок - Металлинвест\n* 4% на весь срок - Совком\n\nСкидка 1%'};
assert.equal(M.mortgageBucket(info),'it');
assert.deepEqual(M.mortgageOffers(info),[{rate:.035,bank:'Металлинвест'},{rate:.04,bank:'Совком'}]);
assert.deepEqual(M.mortgageOffers({...info,description:'Банки: уточняется\nСтавка - 6%\nСкидка 1%'}),[]);
assert.equal(M.mortgageBucket({...info,name:'Комбо ипотека'}),'other');
