// node --test tests/engine.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.window=globalThis;
for(const name of ['data','engine'])vm.runInThisContext(fs.readFileSync(new URL('../assets/'+name+'.js',import.meta.url),'utf8'));
const C=SMCalc,D=C.buildData(SM_DATA),project='ДА — 1 очередь';
const near=(a,b,eps=1)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const raw={projects:[project],settings:{subsidyCompensation:{da1:.1,da2:.2,dnk2:0},specialFlats:['42']},
  mortgage:[{name:'Тест',type:'T',rate:.06,term:30,minPv:.2,subsidy:.2}]};
const input={project,type:'T',base:10000000,disc:0,pv:2000000};
function calc(inp={},program={},data={}){return C.mortgage(C.buildData({...raw,...data,mortgage:[{...raw.mortgage[0],...program}]}),{...input,...inp}).rows[0];}

test('buildData сохраняет настройки, каталог акций и параметры совместимости',()=>{
  const data=C.buildData({...raw,promotions:[{id:'a',percent:.05,scope:'promotion'}],
    cashDiscounts:{[project]:{percent:.13}},mortgage:[{...raw.mortgage[0],compatiblePromotions:[],combinationMode:'sequential'}]});
  assert.deepEqual(data.settings,raw.settings);assert.equal(data.promotions[0].id,'a');
  assert.deepEqual(data.programs[0].compatiblePromotions,[]);assert.equal(data.programs[0].extraSequential,true);
  assert.equal(C.cashDiscount(data,project),.13);assert.equal(C.compensationLimit(data,project),.1);
  assert.equal(C.compensationLimit(data,'ДА — 2 очередь'),.2);assert.equal(C.compensationLimit(data,'ДНК — 2 очередь'),0);
  assert.equal(D.programs.length,53);assert.equal(D.installments.length,9);
});
test('отсутствие подключённого каталога сохраняет резервную скидку старых данных',()=>{
  assert.equal(D.cashDiscountCatalogPresent,false);
  assert.equal(C.cashDiscount(D,project),.13);
  const data=C.buildData({defaultDiscount:.13,installments:[{name:'Старая',scheme:'deferred',minPv:.2,months:12,pvFromBase:true}]});
  const card=C.installments(data,{project,base:10000000,downRub:7100000},new Date(2026,10,18))[0];
  assert.ok(!card.error);assert.equal(card.disc,.13);assert.equal(card.total,8700000);
});
test('пустой каталог и отсутствие скидки конкретного проекта не возвращают резервные 13%',()=>{
  for(const cashDiscounts of [{},{'ДА — 2 очередь':{percent:.2}}]){
    const data=C.buildData({...raw,defaultDiscount:.13,cashDiscounts});
    assert.equal(data.cashDiscountCatalogPresent,true);assert.equal(C.cashDiscount(data,project),0);
    const r=C.mortgage(data,{...input,disc:C.cashDiscount(data,project)}).rows[0];
    assert.equal(r.cashPrice,10000000);
  }
});
test('без активного источника высокий ПВ блокируется явно, обычная рассрочка сохраняется',()=>{
  for(const scheme of ['equal','monthly','deferred','scheduled']){
    const data=C.buildData({defaultDiscount:.13,cashDiscounts:{},installments:[{
      name:'Без cash-источника',scheme,months:12,minPv:.2,disc:.05,pvFromBase:true,pay:{1:50000},steps:[1]
    }]});
    for(const downRub of [7100000,9900000,10000000]){
      const c=C.installments(data,{project,base:10000000,downRub,rooms:1},new Date(2026,10,18))[0];
      assert.match(c.error,/нет действующих условий скидки при 100% оплате/);
      assert.deepEqual(c.rows,[]);assert.equal(c.cashDiscountApplied,false);assert.notEqual(c.disc,.13);
    }
    const low=C.installments(data,{project,base:10000000,downRub:3000000,rooms:1},new Date(2026,10,18))[0];
    assert.ok(!low.error);assert.equal(low.disc,.05);assert.equal(low.total,9500000);
  }
});
test('архивация cash-записи проходит модель, но не включает резервную скидку; восстановление возвращает расчёт',()=>{
  vm.runInThisContext(fs.readFileSync(new URL('../assets/tools-model.js',import.meta.url),'utf8'));
  const snapshot=JSON.parse(fs.readFileSync(new URL('../assets/tools.json',import.meta.url),'utf8'));
  const cash=snapshot.records.find(r=>r.kind==='discount'&&r.project==='da1'&&r.enabled);
  assert.ok(cash);cash.enabled=false;
  const build=()=>C.buildData({...SM_DATA,...SMToolsModel.calcData(snapshot)});
  let data=build();assert.equal(C.cashDiscount(data,project),0);
  const cards=C.installments(data,{project,base:10000000,downRub:7100000,rooms:1},new Date(2026,10,18));
  assert.ok(cards.length);for(const c of cards){assert.match(c.error,/нет действующих условий скидки/);assert.deepEqual(c.rows,[]);}
  cash.enabled=true;cash.params.percent=.11;delete cash.params.launchDiscount;
  data=build();assert.equal(C.cashDiscount(data,project),.11);
  const restored=C.installments(data,{project,base:10000000,downRub:7100000,rooms:1},new Date(2026,10,18))[0];
  assert.ok(!restored.error);assert.equal(restored.total,8900000);
});
test('активная нулевая скидка является источником, включая ключ проекта da1',()=>{
  for(const key of [project,'da1']){
    const data=C.buildData({defaultDiscount:.13,cashDiscounts:{[key]:{percent:0}},
      installments:[{name:'Нулевая скидка',scheme:'deferred',minPv:.2,months:12,pvFromBase:true}]});
    assert.equal(C.cashDiscount(data,project),0);
    const c=C.installments(data,{project,base:10000000,downRub:7100000},new Date(2026,10,18))[0];
    assert.ok(!c.error);assert.equal(c.disc,0);assert.equal(c.total,10000000);assert.equal(c.cashDiscountApplied,true);
  }
});
test('выключенная компенсация: аналитическое решение от окончательного ДДУ − ПВ',()=>{
  const r=calc();assert.equal(r.cashPrice,10000000);assert.equal(r.price,12000000);
  assert.equal(r.pv,2000000);assert.equal(r.loan,10000000);assert.equal(r.subsidy,2000000);
  assert.equal(r.clientSubsidy,2000000);assert.equal(r.companyCompensation,0);
  assert.ok(r.ok,'Превышение прайса само по себе не запрещает ипотеку');
});
test('компания покрывает комиссию полностью, остаток лимита не становится скидкой',()=>{
  for(const [subsidy,fee] of [[.2,1000000],[.12,600000]]){
    const r=calc({companyPays:true,pv:5000000},{subsidy});
    assert.equal(r.price,10000000);assert.equal(r.loan,5000000);assert.equal(r.subsidy,fee);
    assert.equal(r.companyCompensation,fee);assert.equal(r.clientSubsidy,0);
  }
});
test('частичная компенсация увеличивает кредит и фактическую комиссию',()=>{
  const r=calc({companyPays:true});assert.equal(r.price,10750000);assert.equal(r.loan,8750000);
  assert.equal(r.subsidy,1750000);assert.equal(r.companyCompensation,1000000);assert.equal(r.clientSubsidy,750000);
  assert.equal(r.price,r.cashPrice+r.subsidy-r.companyCompensation);
});
test('лимит берётся от акционной цены, включая точную цену Macro',()=>{
  const r=calc({cash:8500123,disc:.15,companyPays:true,compensationLimit:.07});
  near(r.compensationCap,8500123*.07,.001);near(r.subsidy,r.loan*.2,.001);
  near(r.price,r.cashPrice+r.clientSubsidy,.5);
  assert.equal(r.cashPrice,8500123);
});
test('изменение взноса и лимита пересчитывает распределение, нулевой лимит допустим',()=>{
  const low=calc({companyPays:true,pv:2000000}),high=calc({companyPays:true,pv:6000000});
  assert.ok(high.subsidy<low.subsidy);assert.equal(high.clientSubsidy,0);
  const zero=calc({companyPays:true,compensationLimit:0});assert.equal(zero.price,calc().price);
  assert.equal(calc({companyPays:true,compensationLimit:.2}).price,10000000);
});
test('отсутствующая настройка не заменяется константой и даёт предупреждение',()=>{
  const r=calc({companyPays:true},{},{settings:{}});
  assert.equal(r.companyCompensation,0);assert.match(r.compensationWarning,/не задан/);
  assert.equal(calc({companyPays:false},{},{settings:{}}).compensationWarning,'');
});
test('минимальный взнос удерживает окончательный кредит в лимите банка',()=>{
  for(const companyPays of [false,true])for(const subsidy of [0,.12,.2,.4]){
    const r=calc({companyPays,pv:1},{limit:6000000,subsidy});
    assert.ok(r.loan<=6000000);assert.equal(r.pv+r.loan,r.price);assert.ok(r.pvRaised);
    assert.match(r.note,/не больше/);near(r.subsidy,r.loan*subsidy,.001);
  }
});
test('кредит всегда от ДДУ, устаревшая опция loanFromBase не меняет результат',()=>{
  const data=C.buildData(raw),a=C.mortgage(data,input).rows[0],b=C.mortgage(data,input,{loanFromBase:true}).rows[0];
  assert.equal(a.loan,b.loan);assert.equal(a.pay1,b.pay1);
});
test('без комиссии компенсация отсутствует; ограничения банка и нулевой кредит сохраняются',()=>{
  const r=calc({companyPays:true},{subsidy:0});assert.equal(r.companyCompensation,0);assert.equal(r.price,10000000);
  assert.equal(calc({pv:10000000}).status,'Кредит не нужен');
  assert.equal(calc({pv:6000000},{maxPv:.5}).status,'Взнос больше допустимого');
  assert.equal(calc({},{subsidy:1}).status,'Некорректная комиссия банка');
  assert.equal(calc({},{minPrice:11000000}).status,'Не для этой квартиры');
  assert.equal(calc({pv:9500000},{minLoan:1000000}).status,'Кредит меньше минимального');
});
test('каталог ипотек: фильтры, ручной выбор и аннуитетный график',()=>{
  for(const project of D.projects)for(const type of D.types)for(const kids of C.kidsOptions(D,project,type).concat([null])){
    const inp={project,type,kids,base:12345678,disc:.19,pv:3000000,companyPays:true,compensationLimit:.1};
    const res=C.mortgage(D,inp);
    for(const r of res.rows.filter(r=>r.ok)){
      assert.equal(r.loan+r.pv,r.price);near(r.subsidy,r.loan*r.sub,.001);
      let balance=r.loan;for(let m=0;m<r.term*12;m++)balance=balance*(1+r.r1/12)-r.pay1;
      near(balance,0,.1);assert.ok(r.loan<=r.limit);
    }
    if(res.best){const pick=res.rows.find(r=>r.ok).id;assert.equal(C.mortgage(D,{...inp,pick}).best.id,pick);}
  }
});
test('льготная ставка пересчитывается на остаток; срок в пределах программы',()=>{
  const r=calc({term:15},{rate:.01,rateAfter:.195,graceYears:2,subsidy:0});
  assert.equal(r.graceMonths,24);let balance=r.loan;
  for(let m=0;m<180;m++)balance=balance*(1+(m<24?.01:.195)/12)-(m<24?r.pay1:r.pay2);
  near(balance,0,.1);assert.equal(calc({term:30},{term:10}).term,10);
});
test('совместимые акции: сумма, последовательность, удалённые ID и информационные акции',()=>{
  const promotions=[{id:'a',name:'Пять',percent:.05,projects:[project],scope:'promotion'},
    {id:'info',name:'Подарок',projects:[project],scope:'promotion'},
    {id:'cash',percent:.05,scope:'cash'},{id:'other',percent:.5,projects:['ДНК — 2 очередь'],scope:'promotion'}];
  const settings={promotions},params={subsidy:0,compatiblePromotions:['a','cash','info','other']};
  const inp={disc:.05,promotionIds:['a','a','cash','info','other','deleted']};
  assert.equal(calc(inp,params,settings).price,9000000);
  assert.equal(calc(inp,{...params,combinationMode:'sequential'},settings).price,9025000);
  assert.deepEqual(calc(inp,params,settings).promotions.map(a=>a.id),['a','info']);
  assert.equal(calc(inp,{...params,compatiblePromotions:[]},settings).price,9500000);
});
