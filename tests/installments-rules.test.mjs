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
  const params={scheme:'monthly',disc:0,pay:{1:400000},milestones:[
    {amount:2500000,date:'2027-06-12'},{share:.05,months:2}]};
  const c=calc(params);balance(c);
  assert.deepEqual(c.rows.map(r=>r.amount),[2000000,4400000,500000,2500000,600000]);
  assert.equal(c.maxPvRub,2600000);
  const limit=calc(params,{downRub:c.maxPvRub});balance(limit);
  assert.equal(limit.rows[1].amount,4400000);assert.equal(limit.rows.at(-1).amount,2500000);
  assert.match(calc(params,{downRub:c.maxPvRub+1}).error,/Максимальный первоначальный взнос/);
  const impossible=calc({scheme:'monthly',disc:0,pay:{1:1000000},milestones:[
    {amount:2500000,date:'2027-06-12'},{share:.05,months:2}]});
  assert.match(impossible.error,/обязательные платежи графика/);assert.deepEqual(impossible.rows,[]);
  const allReserved=calc({scheme:'monthly',minPv:0,disc:0,pay:{1:50000},milestones:[{amount:8000000,months:6}]},{downRub:2000000});
  assert.equal(allReserved.maxPvRub,1450000);assert.match(allReserved.error,/Максимальный первоначальный взнос/);
});
test('граница ПВ учитывает скидку от взноса, обе базы процента и совместимые акции',()=>{
  for(const pvFromBase of [true,false])for(const combinationMode of ['sum','sequential']){
    const params={scheme:'scheduled',disc:0,discFromPv:.3,pvFromBase,combinationMode,compatiblePromotions:['extra'],
      milestones:[{amount:1234567,months:3},{share:.4,months:6}]};
    const raw={promotions:[{id:'extra',scope:'promotion',percent:.07}]},inp={downRub:2000000,promotionIds:['extra']};
    const c=calc(params,inp,raw);balance(c);
    const factor=combinationMode==='sequential'?.93:1;
    assert.equal(c.total,Math.round(base*.93-inp.downRub*.3*factor));
    const max=calc(params,{...inp,downRub:c.maxPvRub},raw);balance(max);
    assert.equal(max.total,Math.round(base*.93-max.rows[0].amount*.3*factor));
    assert.equal(max.share,max.rows[0].amount/(pvFromBase?base:max.total));
    const shareInput=calc(params,{downShare:max.share,promotionIds:['extra']},raw);balance(shareInput);
    assert.equal(shareInput.total,max.total);assert.equal(shareInput.rows[0].amount,max.rows[0].amount);
    assert.match(calc(params,{...inp,downRub:c.maxPvRub+1},raw).error,/Максимальный первоначальный взнос/);
  }
});
test('100% оплаты отменяет график, а неполная оплата сохраняет обязательства',()=>{
  for(const scheme of ['scheduled','monthly'])for(const pvFromBase of [true,false]){
    const params={scheme,pvFromBase,pay:{1:50000},milestones:[{share:.25,months:6},{share:.25,months:9}]};
    for(const inp of [{downRub:8100000},{downShare:1}]){
      const full=calc(params,inp);balance(full);assert.ok(full.fullPayment);
      assert.deepEqual(full.rows.map(r=>r.amount),[8100000]);assert.equal(full.maxPvRub,undefined);
    }
    assert.match(calc(params,{downRub:8099999}).error,/Максимальный первоначальный взнос/);
  }
});
test('реальный каталог: 4/25 при 5 751 000 из 10 млн ограничивает ПВ, сохраняя этапы',()=>{
  vm.runInThisContext(fs.readFileSync(new URL('../assets/tools-model.js',import.meta.url),'utf8'));
  const snapshot=JSON.parse(fs.readFileSync(new URL('../assets/tools.json',import.meta.url),'utf8'));
  const D=C.buildData(SMToolsModel.calcData(snapshot));
  const card=(name,downRub)=>C.installments(D,{project:'ДНК — 2 очередь',base,rooms:1,downRub},date).find(c=>c.name===name);
  const name='Рассрочка 4/25',bad=card(name,5751000);
  assert.equal(bad.share,.71);assert.equal(bad.total,8100000);
  assert.equal(bad.maxPvRub,4650000);assert.equal(bad.maxPvShare,.5);
  assert.match(bad.error,/4\s650\s000/);assert.match(bad.error,/50% стоимости договора/);assert.deepEqual(bad.rows,[]);
  const atMax=card(name,bad.maxPvRub);balance(atMax);assert.equal(atMax.total,9300000);
  assert.deepEqual(atMax.rows.map(r=>r.amount),[4650000,2325000,2325000]);
  assert.match(card(name,bad.maxPvRub+1).error,/Максимальный первоначальный взнос/);
  const normal=card(name,3000000);balance(normal);
  assert.deepEqual(normal.rows.map(r=>r.amount),[3000000,2325000,2325000,1650000]);
  const full=card(name,8100000);balance(full);assert.ok(full.fullPayment);assert.equal(full.rows.length,1);

  const monthly='Рассрочка 20/20',valid=card(monthly,7100000);balance(valid);
  assert.deepEqual(valid.rows.map(r=>r.amount),[7100000,500000,405000,95000]);
  assert.equal(valid.maxPvRub,7195000);
  const monthlyMax=card(monthly,7195000);balance(monthlyMax);
  assert.deepEqual(monthlyMax.rows.map(r=>r.amount),[7195000,500000,405000]);
  assert.match(card(monthly,7195001).error,/Максимальный первоначальный взнос/);
  assert.ok(card(monthly,8100000).fullPayment);

  const noPv='Без первоначального взноса',noPvLimit=card(noPv,5751000);
  assert.equal(noPvLimit.maxPvRub,5750999);assert.match(noPvLimit.error,/Максимальный первоначальный взнос/);
  const below=card(noPv,5750999);balance(below);assert.equal(below.total,10000000);
  assert.deepEqual(below.rows.map(r=>r.amount),[5750999,1250000,1000000,500000,1499001]);
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
