(async function(){
  'use strict';
  await window.SM_TOOLS_READY;
  var U=window.SMUi,F=window.SMCalc.fmt,calc=window.SMTranshCalc,esc=U.esc,$=function(id){return document.getElementById(id);};
  var projects=window.SM_DATA.projects, project=projects[0], selected=null, last=null;
  var el={project:$('sm-project'),flat:$('sm-flat'),price:$('sm-price'),discount:$('sm-discount'),program:$('sm-program'),bank:$('sm-bank'),rate:$('sm-rate'),pv:$('sm-pv'),term:$('sm-term'),first:$('sm-first'),second:$('sm-second'),date1:$('sm-date1'),date2:$('sm-date2'),date3:$('sm-date3'),info:$('sm-program-info'),dateHint:$('sm-date-hint'),result:$('sm-result')};
  var fallback=[
    {name:'Сбербанк · первый транш 20%',projects:['ДНК — 2 очередь'],tranches:3,bank:'Сбербанк',first:.2,second:.2,rate:.192,discount:.12,minPv:.2,secondMonths:12,date3:'2029-05-01',date3Approx:true,launchDiscount:.02,launchUntil:'2026-11-30'},
    {name:'Сбербанк · первый транш 10%',projects:['ДНК — 2 очередь'],tranches:3,bank:'Сбербанк',first:.1,second:.2,rate:.192,discount:.08,minPv:.2,secondMonths:12,date3:'2029-05-01',date3Approx:true,launchDiscount:.02,launchUntil:'2026-11-30'},
    {name:'Сбербанк · первый транш 1%',projects:['ДНК — 2 очередь'],tranches:3,bank:'Сбербанк',first:.01,second:.2,rate:.192,discount:.05,minPv:.2,minFirst:100000,secondMonths:12,date3:'2029-05-01',date3Approx:true,launchDiscount:.02,launchUntil:'2026-11-30'}
  ];
  projects.slice(0,2).forEach(function(p,i){fallback.push({name:'ДА · расчёт по ориентиру 1 500 ₽',projects:[p],tranches:2,minPv:.201,firstRub:100000,estimate:true,referencePayment:1500,referenceYears:30,date2:i?'2028-09-20':'2027-03-20'});});
  var catalog=window.SM_DATA.tranche||fallback,programs=[],manual=false;
  function isDaEstimate(){return !!selected&&selected.estimate&&!manual;}
  function pad(n){return String(n).padStart(2,'0');}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function localDate(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);}
  function addMonths(s,n){var d=localDate(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d);}
  function showDate(s){return localDate(s).toLocaleDateString('ru-RU');}
  function startDiscount(date){return selected&&date&&selected.launchUntil&&date<=selected.launchUntil;}
  function setProgramDiscount(){if(selected)el.discount.value=String(+(((selected.discount||0)+(startDiscount(el.date1.value)?selected.launchDiscount||0:0))*100).toFixed(4)).replace('.',',');}
  function updateProgramInfo(){if(!selected)return;el.info.textContent=(selected.note||'')+(isDaEstimate()?' Первый транш '+F.rub(selected.firstRub)+', ориентир '+F.rub(selected.referencePayment)+' в месяц на '+selected.referenceYears+' лет. Платежи предварительные.':selected.bank?' '+selected.bank+' · '+F.pct(selected.rate||0)+'.':' Введите подтверждённую ставку банка.');}
  function setupProgram(){programs=catalog.filter(function(p){return p.projects.includes(project);});el.program.innerHTML=programs.map(function(p,i){return '<option value="'+i+'">'+esc(p.name)+'</option>'+(p.estimate?'<option value="'+i+'-manual">'+esc(p.name)+' · по ставке банка</option>':'');}).join('');applyProgram();}
  function applyProgram(){selected=programs[parseInt(el.program.value,10)];manual=el.program.value.endsWith('-manual');if(!selected){render();return;}var three=+selected.tranches===3;
    el.bank.value=selected.bank||'';el.rate.value=isDaEstimate()?String(+(calc.rateFromPayment(selected.firstRub,selected.referencePayment,selected.referenceYears)*100).toFixed(2)).replace('.',','):manual?'':String(+((selected.rate||0)*100).toFixed(4)).replace('.',',');el.rate.readOnly=isDaEstimate();
    $('sm-rate-label').textContent=isDaEstimate()?'Расчётная ставка, %':'Ставка, % годовых';$('sm-rate-hint').textContent=isDaEstimate()?'Восстановлена из ориентира платежа. Это оценка, не ставка банка.':'Ставка банка для выбранной программы.';
    el.first.value=String((selected.first||0)*100);el.second.value=String((selected.second||0)*100);$('sm-first-rub').value=F.int(selected.firstRub||0);
    $('sm-da-tranches').hidden=three;$('sm-dnk-tranches').hidden=!three;$('sm-dnk-stage-hint').hidden=!three;$('sm-third-date').hidden=!three;
    el.pv.value=String(+(selected.minPv*100).toFixed(4)).replace('.',',');el.date2.value=selected.date2||(el.date1.value?addMonths(el.date1.value,selected.secondMonths):'');el.date3.value=selected.date3||'';
    el.dateHint.textContent=selected.date3Approx?'Дата последнего транша требует подтверждения банка.':'';$('sm-date2-hint').textContent=selected.secondMonths?'Через '+selected.secondMonths+' мес. после сделки; дату можно изменить.':'По программе: '+showDate(selected.date2)+'. Дату можно изменить.';
    setProgramDiscount();updateProgramInfo();render();
  }
  function read(){var base=U.parseMoney(el.price.value)||0,discount=U.parsePct(el.discount.value),p=selected||{};return {base:base,discount:discount,price:Math.round(base*(1-discount)),down:U.parsePct(el.pv.value),rate:isDaEstimate()?calc.rateFromPayment(p.firstRub,p.referencePayment,p.referenceYears):U.parsePct(el.rate.value),estimate:isDaEstimate(),years:Number(el.term.value),first:U.parsePct(el.first.value),second:U.parsePct(el.second.value),date1:el.date1.value,date2:el.date2.value,date3:el.date3.value,date3Approx:!!p.date3Approx&&el.date3.value===p.date3,minFirst:p.minFirst||0,tranches:+p.tranches,firstRub:p.firstRub,bank:el.bank.value.trim()};}
  function results(x,r){
    var html='<div class="sm-hero"><div class="sm-hero-name">'+esc(x.bank||'Траншевая ипотека')+'</div><div class="sm-hero-flat">'+esc(project)+(flats.selectedNumber()?' · кв. '+esc(flats.selectedNumber()):'')+'</div><div class="sm-pay"><div><div class="sm-k">Платёж после первого транша</div><div class="sm-v">'+F.rub(r.stages[0].payment)+'</div></div></div></div>';
    html+='<dl><dt>Программа</dt><dd>'+esc(selected ? selected.name.replace('Сбербанк · ', '') : x.estimate?'По ориентиру 1 500 ₽':'По ставке банка')+'</dd><dt>'+(x.estimate?'Оценочная ставка и срок':'Ставка и срок')+'</dt><dd>'+(x.estimate?'≈ ':'')+F.pct(x.rate)+' · '+F.years(x.years)+'</dd><dt>Стоимость квартиры после скидки</dt><dd>'+F.rub(r.price)+'</dd><dt>Первоначальный взнос</dt><dd>'+F.rub(r.down)+'</dd><dt>Общий кредит</dt><dd>'+F.rub(r.total)+'</dd></dl>';
    function stageDate(s){return x.date3Approx&&s===x.date3?showDate(s)+' (день уточняется)':showDate(s);}
    r.stages.forEach(function(s,i){var end=i<r.stages.length-1?' — до '+stageDate(r.stages[i+1].date):' и далее';
      html+='<div class="sm-stage"><div class="sm-stage-heading"><strong>'+(i===r.stages.length-1?(r.stages.length===2?'2-й (остаток)':'Последний'):(i+1)+'-й')+' транш</strong><span class="sm-stage-date">с '+stageDate(s.date)+end+'</span></div><div class="sm-stage-metrics"><div><span>Сумма транша</span><b>'+F.rub(s.amount)+'</b></div><div><span>Всего выдано</span><b>'+F.rub(s.issued)+'</b></div><div><span>Платёж в месяц</span><b class="sm-stage-payment">'+F.rub(s.payment)+'</b></div></div></div>';});
    if(x.estimate)html+='<div class="sm-note">Предварительно по ориентиру: '+F.rub(selected.referencePayment)+' в месяц за первый транш '+F.rub(selected.firstRub)+' на '+selected.referenceYears+' лет. Из него получена расчётная ставка ≈ '+F.pct(x.rate)+'. Платёж после второго транша тоже оценочный; это не предложение банка.</div>';
    html+='<div class="sm-note">Аннуитет считается от суммы выданных траншей на исходный срок '+F.years(x.years)+'. Уменьшение долга между траншами, неполные месяцы и изменение срока не учитываются. Точный график предоставит банк.</div>';
    if(x.date3Approx)html+='<div class="sm-note">Дату последнего транша необходимо уточнить у банка; в источнике есть неоднозначность.</div>';
    if(selected&&selected.minFirst)html+='<div class="sm-note">Первый транш — не менее '+F.rub(selected.minFirst)+' . Последний транш рассчитан как остаток кредита.</div>';

    return html;
  }
  function render(){var x=read();last=null;$('sm-save').disabled=true;
    if(!x.base){el.result.innerHTML='<p class="sm-empty">Выберите квартиру или укажите её стоимость.</p>';return;}
    if(!selected){el.result.innerHTML='<p class="sm-empty">Активных траншевых программ нет.</p>';return;}
    if(x.down<selected.minPv){el.result.innerHTML='<p class="sm-empty">Первоначальный взнос по программе от '+F.pct(selected.minPv)+'.</p>';return;}
    try{var r=calc.calculate(x);el.result.innerHTML=results(x,r);last={x:x,r:r};$('sm-save').disabled=false;}
    catch(e){el.result.innerHTML='<p class="sm-empty">'+esc(e.message)+'</p>';}
  }
  var flats=window.SMFlats.setup({select:el.flat,info:$('sm-flat-info'),price:el.price,project:project,onChange:render});
  U.pills(el.project,projects.map(function(p){return {value:p,label:p};}),project,'v');
  U.onPill(el.project,'v',function(v,btn){project=v;flats.setProject(v);el.date2.value='';el.date3.value='';Array.prototype.forEach.call(el.project.children,function(b){b.setAttribute('aria-pressed',String(b===btn));});setupProgram();});
  el.program.addEventListener('change',applyProgram);U.moneyInput(el.price,render);
  [el.discount,el.rate,el.pv,el.first,el.second].forEach(function(e){U.pctInput(e,render);});
  [el.bank,el.term,el.date2,el.date3].forEach(function(e){e.addEventListener('input',render);});
  el.date1.addEventListener('input',function(){if(selected&&el.date1.value){if(selected.secondMonths)el.date2.value=addMonths(el.date1.value,selected.secondMonths);setProgramDiscount();updateProgramInfo();}render();});
  el.date1.value=iso(new Date());el.date2.value='';
  $('sm-print').addEventListener('click',function(){window.print();});
  U.saveButton($('sm-save'),$('sm-msg'),function(){
    if(!last)return Promise.resolve(null);
    var x=last.x,details=el.result.innerHTML,meta=project+(flats.selectedNumber()?' · кв. '+flats.selectedNumber():'')+' · '+U.stamp();
    return U.makePdf(function(png){var page=U.page(U.reportHead('Траншевая ипотека',meta,png)+'<section class="sm-card">'+details+'</section><p class="sm-legal">Предварительный расчёт. Окончательные условия и график определяет банк.</p>','portrait');return {pages:[page],file:'Траншевая ипотека '+project+' '+new Date().toLocaleDateString('ru-RU')};},'portrait');
  });
  setupProgram();
})();
