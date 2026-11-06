/* Общая схема справочника: сайт, проверка импорта и редактор используют одни правила. */
(function(root){
  'use strict';
  var projects={da1:'ДА — 1 очередь',da2:'ДА — 2 очередь',dnk2:'ДНК — 2 очередь'};
  var categories={mortgage:'Ипотека',installment:'Рассрочка',chpv:'Дофинансирование ПВ · ЧПВ',discount:'Скидки и акции',extra:'Дополнительные инструменты',booking:'Условия бронирования'};
  var modes={sequential:'Последовательно',additive:'Суммируется',none:'Не суммируется',individual:'Индивидуально'};
  function field(key,label,type,extra){return Object.assign({key:key,label:label,type:type},extra||{});}
  var fields={
    mortgage:[field('bank','Банк','text'),field('type','Программа','select',{options:['Семейная ипотека','Базовая ипотека']}),field('kids','Дети','select',{options:['','1 ребёнок','2 ребёнка','3 ребёнка','4 ребёнка','5 и более детей']}),field('term','Кредит, лет','integer',{min:1,max:30}),field('rate','Ставка, %','percent'),field('subsidy','Комиссия банку, %','percent'),field('minPv','Минимальный взнос, %','percent'),field('limit','Лимит кредита, ₽','money'),field('variant','Вариант программы','text')],
    installment:[field('scheme','Схема платежей','select',{options:['equal','monthly','deferred','scheduled'],labels:['Равные платежи','Ежемесячный платёж и остаток','Взнос и остаток','По этапам']}),field('minPv','Первый взнос, %','percent'),field('end','Погашение до','date'),field('months','Или месяцев от сделки','integer',{min:1,max:60}),field('steps','Периодичность, месяцев','steps'),field('pay.1','Студия / 1к, ₽ в месяц','money'),field('pay.2','2к, ₽ в месяц','money'),field('pay.3','3к, ₽ в месяц','money'),field('disc','Скидка, %','percent'),field('discFromPv','Скидка на сумму ПВ, %','percent'),field('maxDisc','Потолок скидки, %','percent'),field('pvFromBase','Взнос от прайса','boolean'),field('launchDiscount','Стартовая скидка, %','percent'),field('launchUntil','Стартовая скидка до','date'),field('pvChoices','Варианты взноса, %','percentList'),field('discAt70','Скидка при ПВ от 70%, %','percent')],
    tranche:[field('bank','Банк','text'),field('tranches','Количество траншей','select',{options:['2','3']}),field('minPv','Первый взнос, %','percent'),field('rate','Ставка, %','percent'),field('estimate','Расчёт по ориентиру','boolean'),field('referencePayment','Ориентир в месяц, ₽','money'),field('referenceYears','Ориентир: кредит, лет','integer',{min:1,max:30}),field('firstRub','Первый транш, ₽ (для двух)','money'),field('first','Первый транш, % (для трёх)','percent'),field('second','Второй транш, % (для трёх)','percent'),field('minFirst','Минимум первого транша, ₽','money'),field('date2','Дата второго транша','date'),field('secondMonths','Или месяцев до второго','integer',{min:1,max:60}),field('date3','Дата последнего транша','date'),field('discount','Скидка, %','percent'),field('launchDiscount','Стартовая скидка, %','percent'),field('launchUntil','Стартовая скидка до','date')],
    chpv:[field('limit','Лимит кредита, ₽','money'),field('years','Кредит, лет','integer',{min:1,max:30}),field('rate','Ставка, %','percent'),field('minDown','Минимальный взнос, %','percent'),field('cost','Стоимость финансирования, %','percent'),field('overRate','Ставка сверхлимита, %','percent')],
    discount:[field('percent','Скидка, %','percent'),field('launchDiscount','Стартовая скидка, %','percent'),field('launchUntil','Стартовая скидка до','date')],info:[]
  };
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function get(p,key){return key.split('.').reduce(function(v,k){return v==null?undefined:v[k];},p);}
  function set(p,key,value){var parts=key.split('.');if(parts.length===2){if(!p[parts[0]])p[parts[0]]={};p[parts[0]][parts[1]]=value;}else p[key]=value;}
  function number(n,min,max){return typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;}
  function validDate(s,month){if(typeof s!=='string')return false;if(month&&/^\d{4}-\d{2}$/.test(s))s+='-01';return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
  function required(ok,message){if(!ok)throw new Error(message);}
  function validateRecord(r){
    required(r&&typeof r==='object','Не найдена программа.');
    required(/^[a-zA-Z0-9_-]{1,100}$/.test(r.id||''),'Некорректный ID программы.');
    required(projects[r.project]&&categories[r.category]&&fields[r.kind],'Неизвестный проект или раздел.');
    required(typeof r.group==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.group),'Некорректная группа.');
    ['name','description','combination'].forEach(function(k){required(typeof r[k]==='string'&&r[k].length<10000,'Проверьте текст программы.');});
    required(r.name.trim()&&r.name.length<=200,'Введите название до 200 знаков.');
    required(modes[r.mode]&&typeof r.enabled==='boolean','Проверьте сочетание и доступность программы.');
    required(r.params&&typeof r.params==='object'&&!Array.isArray(r.params),'Не заданы параметры.');
    var p=r.params,allowed=fields[r.kind].map(function(f){return f.key.split('.')[0];}).concat(['note','validUntil','milestones','noExtra','extraSequential','scope','date3Approx']);
    Object.keys(p).forEach(function(k){required(allowed.includes(k),'Неизвестное поле: '+k);});
    fields[r.kind].forEach(function(f){var v=get(p,f.key);if(v==null||v==='')return;
      if(f.type==='percent')required(number(v,0,.99),f.label+': от 0 до 99%.');
      if(f.type==='money')required(number(v,0,1000000000)&&Number.isInteger(v),f.label+': целая положительная сумма.');
      if(f.type==='integer')required(Number.isInteger(v)&&number(v,f.min,f.max),f.label+': '+f.min+'–'+f.max+'.');
      if(f.type==='date')required(validDate(v),f.label+': некорректная дата.');
      if(f.type==='text')required(typeof v==='string'&&v.length<=200,f.label+': слишком длинный текст.');
      if(f.type==='boolean')required(typeof v==='boolean',f.label+': неверное значение.');
      if(f.type==='select')required(f.options.includes(String(v)),f.label+': выберите значение из списка.');
      if(f.type==='steps')required(Array.isArray(v)&&v.length&&v.every(function(n){return [1,3,6,12].includes(n);}), 'Периодичность: 1, 3, 6 или 12 месяцев.');
      if(f.type==='percentList')required(Array.isArray(v)&&v.every(function(n){return number(n,0,.99)&&n>=p.minPv;}),'Варианты взноса должны быть не меньше минимального.');
    });
    if(p.validUntil)required(validDate(p.validUntil),'Некорректная дата действия в источнике.');
    if(r.kind==='mortgage'){
      required(p.bank&&p.type&&number(p.rate,0,.99)&&number(p.subsidy,0,.99)&&number(p.minPv,0,.99)&&p.term,'Заполните банк, ставку, комиссию, взнос и кредит в годах.');
      if(p.type==='Семейная ипотека')required(p.kids&&p.limit>0,'Для семейной ипотеки нужны дети и лимит.');
    }
    if(r.kind==='installment'){
      required(p.scheme&&number(p.minPv,0,.99),'Укажите схему и взнос.');
      required(!!p.end!==!!p.months,'Укажите либо дату погашения, либо число месяцев от сделки.');
      if(p.scheme==='monthly')required(p.pay&&[1,2,3].every(function(n){return number(p.pay[n],1,1000000000);}), 'Задайте платежи для всех планировок.');
      if(p.scheme==='equal')required(p.steps&&p.steps.length,'Укажите периодичность платежей.');
      if(p.discFromPv)required(p.pvFromBase===true,'Скидка на ПВ требует взноса от прайса.');
      if(p.pay)required(Object.keys(p.pay).every(function(k){return ['1','2','3'].includes(k);}), 'Неизвестная планировка.');
      if(p.milestones){required(Array.isArray(p.milestones)&&p.milestones.length<=12,'Не более 12 этапов.');p.milestones.forEach(function(m){required(m&&number(m.share,0,.99)&&m.share>0&&(!!m.date!==!!m.months),'Этап: доля и дата либо месяц.');if(m.date)required(validDate(m.date,true),'Проверьте дату этапа.');if(m.months)required(Number.isInteger(m.months)&&number(m.months,1,60),'Проверьте месяц этапа.');});required(p.minPv+p.milestones.reduce(function(a,m){return a+m.share;},0)<1.000001,'Взнос и этапы превышают 100%.');}
    }
    if(r.kind==='tranche'){
      required([2,3].includes(+p.tranches)&&p.minPv>=.2,'Для траншей нужны 2 или 3 этапа и ПВ от 20%.');
      if(p.estimate)required(p.firstRub>0&&p.referencePayment>0&&p.referenceYears>0,'Заполните ориентир платежа.');else required(p.rate>0,'Укажите ставку.');
      required(!!p.date2!==!!p.secondMonths,'Второй транш: дата или число месяцев.');
      if(+p.tranches===2)required(p.firstRub>0,'Укажите первый транш в рублях.');
      else required(p.first>0&&p.second>0&&p.minPv+p.first+p.second<1&&validDate(p.date3),'Проверьте доли и дату третьего транша.');
    }
    if(r.kind==='chpv')required(p.limit>0&&p.years&&p.rate>0&&p.minDown>0&&number(p.cost,0,.99)&&p.overRate>0,'Заполните все параметры ЧПВ.');
    if(r.kind==='discount')required(number(p.percent,0,.99)&&p.scope==='cash','Скидка должна относиться к полной оплате.');
    if(p.launchDiscount)required(validDate(p.launchUntil),'Укажите дату окончания стартовой скидки.');
    var expected={mortgage:'mortgage',tranche:'mortgage',installment:'installment',chpv:'chpv',discount:'discount'};
    if(expected[r.kind])required(r.category===expected[r.kind],'Механика не соответствует разделу.');
    return r;
  }
  function validate(data){
    required(data&&data.version===1&&Array.isArray(data.records)&&data.records.length>0&&data.records.length<=600,'Неверный формат справочника.');
    var ids=new Set(),cash=new Set();data.records.forEach(function(r){validateRecord(r);required(!ids.has(r.id),'Повтор ID программы.');ids.add(r.id);if(r.enabled&&r.kind==='discount'){required(!cash.has(r.project),'Для проекта допустима одна основная скидка за полную оплату.');cash.add(r.project);}});
    Object.keys(projects).forEach(function(project){required(data.records.some(function(r){return r.project===project&&r.kind==='installment'&&r.enabled;}),'Нет рассрочек одного из проектов.');required(data.records.some(function(r){return r.project===project&&r.kind==='mortgage'&&r.enabled;}),'Нет ипотеки одного из проектов.');});
    return data;
  }
  function calcData(data){validate(data);var out={mortgage:[],installments:[],tranche:[],chpv:[],cashDiscounts:{}};
    data.records.filter(function(r){return r.enabled;}).forEach(function(r){var p=clone(r.params);p.projects=[projects[r.project]];p.name=r.name;p.note=[p.note,r.description].filter(Boolean).join(' ');p.catalogId=r.id;
      if(r.kind==='mortgage')out.mortgage.push(p);
      if(r.kind==='installment'){p.extraSequential=r.mode==='sequential';p.noExtra=r.mode==='none'||r.mode==='individual';out.installments.push(p);}
      if(r.kind==='tranche')out.tranche.push(p);
      if(r.kind==='chpv')out.chpv.push(p);
      if(r.kind==='discount'&&p.scope==='cash')out.cashDiscounts[projects[r.project]]=p;
    });return out;
  }
  var nf=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  function pct(v){return nf.format((v||0)*100)+'%';}function rub(v){return nf.format(v||0)+' ₽';}
  function dmy(s){return (s||'').split('-').reverse().join('.');}
  function summary(r){var p=r.params,a=[];
    if(r.kind==='mortgage')a=[p.bank+' · '+pct(p.rate), (p.kids||p.variant||p.type)+' · до '+p.term+' лет','ПВ от '+pct(p.minPv)+(p.limit?' · до '+rub(p.limit):'')];
    if(r.kind==='installment'){
      a=['ПВ '+pct(p.minPv)+(p.pvFromBase?' от прайса':'')];
      if(p.scheme==='equal')a.push('Равные платежи');if(p.scheme==='monthly')a.push('От '+rub(Math.min.apply(null,Object.values(p.pay)))+'/мес.');
      if(p.scheme==='deferred')a.push('Без промежуточных платежей');if(p.scheme==='scheduled')a.push('По этапам');
      a.push(p.end?'Погашение до '+dmy(p.end):p.months+' мес. от сделки');
      if(p.discFromPv)a.push(pct(p.discFromPv)+' на сумму ПВ');else if(p.disc)a.push('Скидка '+pct(p.disc));
      if(p.launchDiscount)a.push('+'+pct(p.launchDiscount)+' до '+dmy(p.launchUntil));
    }
    if(r.kind==='tranche')a=[p.bank||'Траншевая ипотека','ПВ от '+pct(p.minPv),+p.tranches===2?rub(p.firstRub)+' + остаток':pct(p.first)+' → '+pct(p.second)+' → остаток',p.estimate?'Ориентир '+rub(p.referencePayment)+'/мес.':pct(p.rate)+' годовых'];
    if(r.kind==='chpv')a=[pct(p.rate)+' · до '+rub(p.limit),'ПВ от '+pct(p.minDown),'Стоимость финансирования '+pct(p.cost)];
    if(r.kind==='discount')a=['Скидка до '+pct(p.percent),p.launchDiscount?'+'+pct(p.launchDiscount)+' до '+dmy(p.launchUntil):''];
    if(r.kind==='info')a=[r.description];
    return a.filter(Boolean);
  }
  function groups(data){var out=[],map={};data.records.forEach(function(r){var key=r.category+':'+r.group;if(!map[key]){map[key]={id:r.group,category:r.category,name:r.name,cells:{}};out.push(map[key]);}if(!map[key].cells[r.project])map[key].cells[r.project]=[];map[key].cells[r.project].push(r);});return out;}
  var api={projects:projects,categories:categories,modes:modes,fields:fields,clone:clone,get:get,set:set,validate:validate,validateRecord:validateRecord,calcData:calcData,summary:summary,groups:groups,pct:pct,rub:rub};
  root.SMToolsModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
