import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
globalThis.window=globalThis;
vm.runInThisContext(fs.readFileSync(new URL('../assets/engine.js',import.meta.url),'utf8'));
const C=SMCalc,project='ДА — 1 очередь',date=new Date(2026,10,18),base=10000000;
const near=(a,b,eps=1)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const balance=c=>{assert.ok(!c.error,c.error);assert.equal(c.rows.reduce((sum,r)=>sum+r.amount,0),c.total);assert.ok(c.rows.every(r=>Number.isFinite(r.amount)&&r.amount>=0));};
function calc(params={},inp={},raw={}){
  const D=C.buildData({projects:[project],cashDiscounts:{[project]:{percent:.19}},
    installments:[{name:'Тест',scheme:'equal',months:12,minPv:.2,disc:.05,pvFromBase:true,steps:[1,2,3,6,12],...params}],...raw});
  return C.installments(D,{project,base,rooms:1,...inp},date)[0];
}
test('порог 71% включительно во всех схемах, скидка заменяет стандартную',()=>{
  for(const scheme of ['equal','monthly','deferred','scheduled'])for(const share of [.7,.7099999,.71,.7100001,.8,.99,1]){
    const c=calc({scheme},{pv:{1:share}});balance(c);
    assert.equal(c.disc,share>=.71?.19:.05);assert.equal(c.total,share>=.71?8100000:9500000);
    if(share===1){assert.equal(c.rows.length,1);assert.equal(c.rows[0].amount,c.total);assert.ok(c.fullPayment);}
  }
});
test('ручной ПВ в рублях: граница без округления процентов',()=>{
  for(const [amount,disc] of [[7099999,.05],[7100000,.19],[7100001,.19]]){
    const c=calc({}, {downRub:amount});balance(c);assert.equal(c.disc,disc);assert.equal(c.rows[0].amount,amount);
  }
  const c=calc({pvFromBase:false},{downRub:5751000});balance(c);assert.equal(c.share,.71);assert.equal(c.disc,.19);
  const below=calc({pvFromBase:false},{downRub:5750999});balance(below);assert.equal(below.disc,.05);
});
test('ввод процентов использует ту же долю, что показана в расчёте, 100% закрывает договор',()=>{
  for(const pvFromBase of [false,true])for(const share of [.7,.71,1]){
    const c=calc({pvFromBase},{downShare:share});balance(c);assert.equal(c.share,share);
    assert.equal(c.disc,share>=.71?.19:.05);if(share===1)assert.equal(c.rows[0].amount,c.total);
  }
  assert.match(calc({}, {downShare:.1}).error,/Доля взноса/);
});
test('актуальная скидка 100% берётся из каталога по проекту',()=>{
  assert.equal(calc({}, {pv:{1:.71}}).disc,.19);
  assert.equal(calc({}, {pv:{1:.71}},{cashDiscounts:{[project]:{percent:.23}}}).disc,.23);
  assert.equal(calc({}, {pv:{1:.71}},{cashDiscounts:{[project]:{percent:.2,launchDiscount:.03,launchUntil:'2026-11-18'}}}).disc,.23);
});
test('старые maxDisc, launchDiscount, pvChoices и discAt70 не влияют',()=>{
  const old={maxDisc:.01,launchDiscount:.4,launchUntil:'2030-01-01',pvChoices:[.2],discAt70:.5};
  for(const share of [.4,.7,.71]){
    const expected=calc({}, {downShare:share}),actual=calc(old,{downShare:share});
    balance(actual);assert.equal(actual.disc,expected.disc);assert.equal(actual.total,expected.total);
  }
  assert.ok(!calc(old,{downRub:4567890}).error);
});
test('скидка только от ПВ либо от всей цены: суммы и внутренняя точность',()=>{
  const pv=calc({disc:0,discFromPv:.3},{downRub:4152222});balance(pv);
  near(pv.disc,.12456666,1e-10);assert.equal(pv.total,8754333);assert.equal(C.fmt.pct0(pv.disc),'12%');
  assert.equal(C.fmt.pct0(.125678),'13%');assert.equal(C.fmt.pct0(.125),'13%');
  const all=calc({disc:.3,discFromPv:0},{downRub:4152222});balance(all);assert.equal(all.total,7000000);
  const fromDdu=calc({disc:0,discFromPv:.3,pvFromBase:false},{downRub:3000000});balance(fromDdu);
  assert.equal(fromDdu.total,9100000);near(fromDdu.disc,.09,1e-8);
});
test('равные платежи: только разрешённая периодичность, включая 2 месяца',()=>{
  for(const step of [1,2,3,6,12]){
    const c=calc({}, {step:{1:step}});balance(c);assert.equal(c.step,step);
    assert.equal(c.payment,Math.floor(7500000/(12/step)));
    assert.ok(c.steps.find(s=>s.step===2).name.includes('2 месяца'));
  }
  assert.equal(calc({steps:[2,6]},{step:{1:3}}).step,2);
  assert.equal(calc({steps:[0,4,2,2]}).step,2);
});
test('скрытые параметры не влияют на чужую схему',()=>{
  const hidden={steps:[12],pay:{1:99999999},milestones:[{amount:999999999,date:'2020-01-01'}]};
  for(const scheme of ['equal','deferred']){
    const dirty={...hidden,scheme};if(scheme==='equal')dirty.steps=[1];
    const clean={scheme};
    const a=calc(dirty),b=calc(clean);balance(a);assert.deepEqual(a.rows,b.rows);
  }
  const deferred=calc({...hidden,scheme:'deferred'});assert.equal(deferred.rows.length,2);assert.equal(deferred.steps,undefined);
});
test('ежемесячная рассрочка сочетает платежи, годовой этап 5% и конечный остаток',()=>{
  for(const minPv of [0,.2]){
    const c=calc({scheme:'monthly',minPv,months:24,disc:0,steps:[12],pay:{1:50000},
      milestones:[{share:.05,months:12}]});balance(c);
    assert.deepEqual(c.rows.map(r=>r.amount),[base*minPv,1150000,500000,base*(1-minPv)-1650000]);
    assert.equal(c.rows[1].when,'ежемесячно');assert.equal(c.rows[2].when,'до 18.11.2027');
    assert.equal(c.rows[2].sub,'5% стоимости');assert.equal(c.rows.at(-1).when,'до 18.11.2028');
    assert.equal(c.rows.at(-1).final,true);assert.equal(c.steps,undefined);
  }
});
test('ежемесячные платежи резервируют деньги под фиксированные и процентные этапы',()=>{
  const c=calc({scheme:'monthly',disc:0,pay:{1:1000000},milestones:[
    {amount:2500000,date:'2027-06-12'},{share:.05,months:2}]});balance(c);
  assert.deepEqual(c.rows.map(r=>r.amount),[2000000,5000000,500000,2500000]);
  const allReserved=calc({scheme:'monthly',disc:0,pay:{1:50000},milestones:[{amount:8000000,months:6}]});
  balance(allReserved);assert.equal(allReserved.payment,0);assert.deepEqual(allReserved.rows.map(r=>r.amount),[2000000,8000000]);
});
test('этапы: точные даты и суммы рублей, порядок и остаток, без скрытой ежемесячной суммы',()=>{
  const c=calc({scheme:'scheduled',pay:{1:100000},steps:[2],milestones:[
    {amount:2000000,date:'2027-06-12'},{amount:1000000,date:'2026-12-03'}]});balance(c);
  assert.deepEqual(c.rows.map(r=>r.amount),[2000000,1000000,2000000,4500000]);
  assert.equal(c.rows[1].when,'до 03.12.2026');assert.equal(c.payment,undefined);assert.equal(c.steps,undefined);
});
test('старые этапы share/months и YYYY-MM остаются читаемыми',()=>{
  const c=calc({scheme:'scheduled',milestones:[{share:.1,months:2},{share:.1,date:'2027-02'}]});balance(c);
  assert.equal(c.rows[1].amount,950000);assert.equal(c.rows[1].when,'до 18.01.2027');
  assert.equal(C.fmt.dmy(c.rows[2].date),'28.02.2027');assert.match(c.rows[2].when,/день уточняется/);
});
test('этапы проверяют даты, сумму и окончание графика',()=>{
  for(const scheme of ['scheduled','monthly'])for(const m of [{amount:100,date:'2027-02-30'},{amount:100,date:'2026-11-18'},
    {amount:100,date:'2028-01-01'},{amount:-100,date:'2027-01-01'},
    {amount:100.5,date:'2027-01-01'},{amount:9000000,date:'2027-01-01'}]){
    const c=calc({scheme,pay:{1:50000},milestones:[m]});assert.ok(c.error);assert.deepEqual(c.rows,[]);
  }
  const full=calc({scheme:'scheduled',milestones:[{amount:7500000,date:'2027-11-18'}]});balance(full);assert.equal(full.rows.length,2);
});
test('совместимость акций: суммы и последовательность, нет обхода ручной доп. скидкой',()=>{
  const promotions=[{id:'five',scope:'promotion',percent:.05},{id:'info',scope:'promotion',name:'Подарок'},
    {id:'cash',scope:'cash',percent:.19},{id:'foreign',scope:'promotion',percent:.9,projects:['ДНК — 2 очередь']}];
  const params={compatiblePromotions:['five','info','cash','foreign']};
  const inp={extra:.3,promotionIds:['five','five','info','cash','foreign','deleted']};
  const sum=calc(params,inp,{promotions});balance(sum);assert.equal(sum.total,9000000);
  assert.deepEqual(sum.promotions.map(a=>a.id),['five','info']);
  const seq=calc({...params,combinationMode:'sequential'},inp,{promotions});balance(seq);assert.equal(seq.total,9025000);
  assert.equal(calc({compatiblePromotions:[]},inp,{promotions}).total,9500000);
  assert.equal(calc(params,{...inp,downShare:.71},{promotions}).total,7600000);
  assert.equal(calc({noExtra:true},{extra:.05}).total,9500000);
});
test('общие helpers для ЧПВ и траншей соблюдают тот же контракт',()=>{
  const promotions=[{id:'a',percent:.05},{id:'b',percent:.05},{id:'cash',percent:.5,scope:'cash'},{id:'info'}];
  const program={compatiblePromotions:['a','b','cash','info']};
  assert.deepEqual(C.promotionRates(promotions,project,program,['a','b','cash','info']),[.05,.05]);
  assert.equal(C.discountedPrice(base,0,[.05,.05],'sum'),9000000);
  assert.equal(C.discountedPrice(base,0,[.05,.05],'sequential'),9025000);
  assert.deepEqual(C.promotionRates(promotions,project,{compatiblePromotions:[]},['a']),[]);
  assert.deepEqual(C.promotionRates(promotions,project,{combinationMode:'none'},['a']),[]);
});
