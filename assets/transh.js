(function(){
  'use strict';
  var U=window.SMUi,F=window.SMCalc.fmt,calc=window.SMTranshCalc,esc=U.esc,$=function(id){return document.getElementById(id);};
  var projects=window.SM_DATA.projects, project=projects[0], selected=null, last=null;
  var el={project:$('sm-project'),flat:$('sm-flat'),price:$('sm-price'),discount:$('sm-discount'),program:$('sm-program'),bank:$('sm-bank'),rate:$('sm-rate'),pv:$('sm-pv'),term:$('sm-term'),first:$('sm-first'),second:$('sm-second'),date1:$('sm-date1'),date2:$('sm-date2'),date3:$('sm-date3'),info:$('sm-program-info'),dateHint:$('sm-date-hint'),result:$('sm-result')};
  var programs=[
    {id:'sber20',name:'Сбербанк · первый транш 20%',first:20,second:20,rate:19.2,discount:12},
    {id:'sber10',name:'Сбербанк · первый транш 10%',first:10,second:20,rate:19.2,discount:8},
    {id:'sber1',name:'Сбербанк · первый транш 1%',first:1,second:20,rate:19.2,discount:5,minFirst:100000}
  ];
  function pad(n){return String(n).padStart(2,'0');}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function localDate(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);}
  function addYear(s){var d=localDate(s),day=d.getDate();d.setDate(1);d.setFullYear(d.getFullYear()+1);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d);}
  function showDate(s){return localDate(s).toLocaleDateString('ru-RU');}
  function setupProgram(){
    var dnk=project==='ДНК — 2 очередь';
    el.program.innerHTML=dnk?programs.map(function(p){return '<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join(''):'<option value="manual">Траншевая ипотека · условия банка уточняются</option>';
    applyProgram();
  }
  function applyProgram(){
    var dnk=project==='ДНК — 2 очередь';
    selected=dnk?programs.find(function(p){return p.id===el.program.value;}):null;
    el.bank.value=dnk?'Сбербанк':'';el.rate.value=selected?String(selected.rate).replace('.',','):'';
    el.first.value=selected?String(selected.first):'';el.second.value=selected?String(selected.second):'';
    el.discount.value=selected?String(selected.discount):'';el.pv.value=dnk?'20':'20,1';
    el.info.textContent=dnk?'Условия из «Инструментов продаж ДНК-2»: ставка 19,2%, срок до 30 лет. Базовая скидка '+selected.discount+'%; дополнительную стартовую скидку 2% до конца ноября 2026 при подтверждении добавьте вручную.':'В инструментах «ДА» указаны ПВ от 20,1% и ориентир 1 500 ₽ до 20.03.2027 / 20.09.2028. Банк, ставка и размеры траншей не указаны — введите подтверждённые условия. Строка действовала до 30.10.2026.';
    el.dateHint.textContent=dnk?'В документе — за месяц до ввода, май 2029. Укажите точную дату.':'Укажите дату по условиям банка.';
    render();
  }
  function read(){
    var base=U.parseMoney(el.price.value)||0, discount=U.parsePct(el.discount.value);
    return {base:base,discount:discount,price:Math.round(base*(1-discount)),down:U.parsePct(el.pv.value),rate:U.parsePct(el.rate.value),years:Number(el.term.value),first:U.parsePct(el.first.value),second:U.parsePct(el.second.value),date1:el.date1.value,date2:el.date2.value,date3:el.date3.value,minFirst:selected?selected.minFirst||0:0,bank:el.bank.value.trim()};
  }
  function results(x,r){
    var html='<div class="sm-hero"><div class="sm-hero-name">'+esc(x.bank)+'</div><div class="sm-hero-flat">'+esc(project)+(flats.selectedNumber()?' · кв. '+esc(flats.selectedNumber()):'')+'</div><div class="sm-pay"><div><div class="sm-k">Платёж после первого транша</div><div class="sm-v">'+F.rub(r.stages[0].payment)+'</div></div></div></div>';
    html+='<dl><dt>Программа</dt><dd>'+esc(selected ? selected.name.replace('Сбербанк · ', '') : 'Индивидуальные условия')+'</dd><dt>Ставка и срок</dt><dd>'+F.pct(x.rate)+' · '+F.years(x.years)+'</dd><dt>Стоимость квартиры после скидки</dt><dd>'+F.rub(r.price)+'</dd><dt>Первоначальный взнос</dt><dd>'+F.rub(r.down)+'</dd><dt>Общий кредит</dt><dd>'+F.rub(r.total)+'</dd></dl>';
    r.stages.forEach(function(s,i){var end=i<2?' — до '+showDate(r.stages[i+1].date):' и далее';
      html+='<div class="sm-stage"><div class="sm-stage-heading"><strong>'+(i===2?'Последний':(i+1)+'-й')+' транш</strong><span class="sm-stage-date">с '+showDate(s.date)+end+'</span></div><div class="sm-stage-metrics"><div><span>Сумма транша</span><b>'+F.rub(s.amount)+'</b></div><div><span>Всего выдано</span><b>'+F.rub(s.issued)+'</b></div><div><span>Платёж в месяц</span><b class="sm-stage-payment">'+F.rub(s.payment)+'</b></div></div></div>';});
    html+='<div class="sm-note">Оценка: аннуитет считается от суммы выданных траншей на исходный срок '+F.years(x.years)+'. Уменьшение долга между траншами, неполные месяцы и изменение срока не учитываются. Точный график предоставит банк.</div>';
    if(selected&&selected.id==='sber1')html+='<div class="sm-note">Первый транш — не менее 100 000 ₽. Последний транш рассчитан как остаток кредита.</div>';
    if(project==='ДНК — 2 очередь' && x.date3.slice(0,7)!=='2029-05')html+='<div class="sm-note">В документе для ДНК-2 последний транш указан на май 2029 года. Проверьте выбранную дату с банком.</div>';
    return html;
  }
  function render(){var x=read();last=null;
    if(!x.bank){el.result.innerHTML='<p class="sm-empty">Укажите банк, параметры траншей и даты выдачи.</p>';return;}
    if(project!=='ДНК — 2 очередь'&&x.down<.201){el.result.innerHTML='<p class="sm-empty">Для ДА в источнике указан первоначальный взнос от 20,1%.</p>';return;}
    try{var r=calc.calculate(x);el.result.innerHTML=results(x,r);last={x:x,r:r};}
    catch(e){el.result.innerHTML='<p class="sm-empty">'+esc(e.message)+'</p>';}
  }
  var flats=window.SMFlats.setup({select:el.flat,info:$('sm-flat-info'),price:el.price,project:project,onChange:render});
  U.pills(el.project,projects.map(function(p){return {value:p,label:p};}),project,'v');
  U.onPill(el.project,'v',function(v,btn){project=v;flats.setProject(v);Array.prototype.forEach.call(el.project.children,function(b){b.setAttribute('aria-pressed',String(b===btn));});setupProgram();});
  el.program.addEventListener('change',applyProgram);U.moneyInput(el.price,render);
  [el.discount,el.rate,el.pv,el.first,el.second].forEach(function(e){U.pctInput(e,render);});
  [el.bank,el.term,el.date2,el.date3].forEach(function(e){e.addEventListener('input',render);});
  el.date1.addEventListener('input',function(){if(el.date1.value)el.date2.value=addYear(el.date1.value);render();});
  el.date1.value=iso(new Date());el.date2.value=addYear(el.date1.value);
  $('sm-print').addEventListener('click',function(){window.print();});
  U.saveButton($('sm-save'),$('sm-msg'),function(){
    if(!last)return Promise.resolve(null);
    var x=last.x,details=el.result.innerHTML,meta=project+(flats.selectedNumber()?' · кв. '+flats.selectedNumber():'')+' · '+U.stamp();
    return U.makePdf(function(png){var page=U.page(U.reportHead('Траншевая ипотека',meta,png)+'<section class="sm-card">'+details+'</section><p class="sm-legal">Предварительный расчёт. Окончательные условия и график определяет банк.</p>','portrait');return {pages:[page],file:'Траншевая ипотека '+project+' '+new Date().toLocaleDateString('ru-RU')};},'portrait');
  });
  setupProgram();
})();
