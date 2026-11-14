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
  fallback.push(
    {"projects":["ДА — 1 очередь"],"name":"Траншевая ипотека · ориентир 1 500 ₽","minPv":0.2,"estimate":true,"referencePayment":1500,"referencePrincipal":100000,"referenceYears":30,"firstRub":100000,"tranches":2,"discount":0.13,"validUntil":"2026-11-30","flexibleTranches":true,"maxDate":"2027-04-20"},
    {"projects":["ДА — 2 очередь"],"name":"Траншевая ипотека · ориентир 1 500 ₽","minPv":0.2,"estimate":true,"referencePayment":1500,"referencePrincipal":100000,"referenceYears":30,"firstRub":100000,"tranches":2,"discount":0.05,"validUntil":"2026-11-30","lastMonthsBeforeCommissioning":1},
    {"projects":["ДА — 1 очередь"],"name":"Траншевая субсидированная · 13%","minPv":0.2,"tranches":2,"first":0.2,"lastMonthsBeforeCommissioning":1,"discount":0.07,"rate":0.13,"validUntil":"2026-11-30"},
    {"projects":["ДА — 2 очередь"],"name":"Траншевая субсидированная · 13%","minPv":0.2,"tranches":2,"first":0.2,"lastMonthsBeforeCommissioning":1,"discount":0.07,"rate":0.13,"validUntil":"2026-11-30"},
    {"projects":["ДА — 2 очередь"],"name":"Траншевая ипотека · 19,2%","minPv":0.2,"tranches":3,"first":0.2,"second":0.2,"secondMonths":12,"lastMonthsBeforeCommissioning":1,"discount":0.1,"rate":0.192,"validUntil":"2026-11-30"}
  );
  var catalog=window.SM_DATA.tranche||fallback,programs=[],manual=false;
  function isDaEstimate(){return !!selected&&selected.estimate&&!manual;}
  function pad(n){return String(n).padStart(2,'0');}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function localDate(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);}
  function showDate(s){return localDate(s).toLocaleDateString('ru-RU');}
  function startDiscount(date){return selected&&date&&selected.launchUntil&&date<=selected.launchUntil;}
  function setProgramDiscount(){if(selected)el.discount.value=String(+(((selected.discount||0)+(startDiscount(el.date1.value)?selected.launchDiscount||0:0))*100).toFixed(4)).replace('.',',');}
  function referencePrincipal(){return selected.referencePrincipal||selected.firstRub;}
  function beforeText(p){return p.lastMonthsBeforeCommissioning===1?'За месяц до ввода':'За '+p.lastMonthsBeforeCommissioning+' мес. до ввода';}
  function updateProgramInfo(){
    var info=selected.note||'';
    if(isDaEstimate())info+=' Ориентир '+F.rub(selected.referencePayment)+' в месяц на '+F.rub(referencePrincipal())+' при сроке '+F.years(selected.referenceYears)+'.';
    else if(!selected.rate||manual)info+=' Введите подтверждённую ставку банка.';
    el.info.textContent=info.trim();
  }
  function syncCommissioning(){
    if(!selected.lastMonthsBeforeCommissioning)return;
    var lastDate=+selected.tranches===3?el.date3:el.date2;
    lastDate.value=calc.addMonths($('sm-commissioning').value,-selected.lastMonthsBeforeCommissioning);
  }
  function addDraw(){
    var row=document.createElement('div');
    row.className='sm-row2';
    row.innerHTML='<label>Сумма промежуточного транша, ₽<input type="text" inputmode="numeric"></label><label>Дата выдачи<input type="date"></label><button type="button" class="sm-btn sm-btn2">Убрать транш</button>';
    var inputs=row.querySelectorAll('input');
    inputs[1].max=selected.maxDate;
    U.moneyInput(inputs[0],render);
    inputs[1].addEventListener('input',render);
    row.querySelector('button').addEventListener('click',function(){row.remove();render();});
    $('sm-draws').appendChild(row);
    inputs[0].focus();
    render();
  }
  function setupProgram(){programs=catalog.filter(function(p){return p.projects.includes(project);});el.program.innerHTML=programs.map(function(p,i){return '<option value="'+i+'">'+esc(p.name)+'</option>'+(p.estimate?'<option value="'+i+'-manual">'+esc(p.name)+' · по ставке банка</option>':'');}).join('');applyProgram();}
  function applyProgram(){
    selected=programs[parseInt(el.program.value,10)];
    manual=el.program.value.endsWith('-manual');
    if(!selected){render();return;}
    var three=+selected.tranches===3, flex=!!selected.flexibleTranches, rub=flex||!!selected.firstRub;
    var estimate=isDaEstimate(), relative=!!selected.lastMonthsBeforeCommissioning;
    el.bank.value=selected.bank||'';
    var rate=estimate?calc.rateFromPayment(referencePrincipal(),selected.referencePayment,selected.referenceYears):selected.rate;
    el.rate.value=manual||!rate?'':String(+(rate*100).toFixed(estimate?2:4)).replace('.',',');
    el.rate.readOnly=estimate;
    $('sm-rate-label').textContent=estimate?'Расчётная ставка, %':'Ставка, % годовых';
    $('sm-rate-hint').textContent=estimate?'Расчёт по ориентиру платежа. Банковская ставка уточняется.':'Ставка банка для выбранной программы.';
    el.first.value=String(+(100*(selected.first||0)).toFixed(4));
    el.second.value=String(+(100*(selected.second||0)).toFixed(4));
    $('sm-first-rub').value=F.int(selected.firstRub||selected.referencePrincipal||(flex?100000:0));
    $('sm-first-rub').readOnly=!flex;
    $('sm-rub-hint').textContent=flex?'Сумму сценария можно изменить. Последний транш — остаток кредита.':'Второй транш — весь оставшийся кредит.';
    $('sm-da-tranches').hidden=!rub;
    $('sm-dnk-tranches').hidden=rub;
    $('sm-second-field').hidden=!three;
    $('sm-dnk-stage-hint').hidden=rub;
    $('sm-third-date').hidden=!three;
    $('sm-flexible').hidden=!flex;
    $('sm-draws').replaceChildren();
    $('sm-first-date').value=flex?el.date1.value:'';
    $('sm-first-date').max=el.date2.max=flex?selected.maxDate:'';
    $('sm-date2-label').textContent=flex?'Последний транш':'Второй транш';
    $('sm-commissioning-field').hidden=!relative;
    $('sm-commissioning').value='';
    el.date2.readOnly=relative&&(!three||!!selected.secondMonths);
    el.date3.readOnly=relative&&three;
    el.pv.value=String(+(selected.minPv*100).toFixed(4)).replace('.',',');
    el.date2.value=selected.date2||(selected.secondMonths?calc.addMonths(el.date1.value,selected.secondMonths):'');
    el.date3.value=selected.date3Approx?'':selected.date3||'';
    el.dateHint.textContent=relative&&three?beforeText(selected):selected.date3Approx?'Месяц выдачи — '+monthText(selected.date3)+'. Можно указать подтверждённый день.':'';
    $('sm-date2-hint').textContent=flex?'До '+showDate(selected.maxDate)+' включительно. Можно оставить дату открытой.':relative&&!three?beforeText(selected):selected.secondMonths?'Через '+selected.secondMonths+' мес. после сделки.':'По программе '+showDate(selected.date2)+'. Дату можно изменить.';
    setProgramDiscount();updateProgramInfo();render();
  }
  function monthText(s){return localDate(s.slice(0,7)+'-01').toLocaleDateString('ru-RU',{month:'long',year:'numeric'});}
  function read(){
    var base=U.parseMoney(el.price.value)||0, discount=U.parsePct(el.discount.value), p=selected||{};
    return {base:base,discount:discount,price:Math.round(base*(1-discount)),down:U.parsePct(el.pv.value),
      rate:isDaEstimate()?calc.rateFromPayment(referencePrincipal(),p.referencePayment,p.referenceYears):U.parsePct(el.rate.value),
      estimate:isDaEstimate(),years:Number(el.term.value),first:U.parsePct(el.first.value),second:U.parsePct(el.second.value),
      date1:el.date1.value,date2:el.date2.value,date3:el.date3.value,
      lastMonth:p.date3Approx&&p.date3&&!el.date3.value?p.date3.slice(0,7):'',
      commissioningDate:$('sm-commissioning').value,lastMonthsBeforeCommissioning:p.lastMonthsBeforeCommissioning,
      flexibleTranches:p.flexibleTranches,maxDate:p.maxDate,firstDate:$('sm-first-date').value,
      draws:Array.from($('sm-draws').children,function(row){var inputs=row.querySelectorAll('input');return {amount:U.parseMoney(inputs[0].value),date:inputs[1].value};}),
      minFirst:p.minFirst||0,tranches:+p.tranches,firstRub:p.flexibleTranches?U.parseMoney($('sm-first-rub').value):p.firstRub,bank:el.bank.value.trim()};
  }
  function results(x,r){
    var html='<div class="sm-hero"><div class="sm-hero-name">'+esc(x.bank||'Траншевая ипотека')+'</div><div class="sm-hero-flat">'+esc(project)+(flats.selectedNumber()?' · кв. '+esc(flats.selectedNumber()):'')+'</div><div class="sm-pay"><div><div class="sm-k">Платёж после первого транша</div><div class="sm-v">'+F.rub(r.stages[0].payment)+'</div></div></div></div>';
    html+='<dl><dt>Программа</dt><dd>'+esc(selected ? selected.name.replace('Сбербанк · ', '') : x.estimate?'По ориентиру 1 500 ₽':'По ставке банка')+'</dd><dt>'+(x.estimate?'Оценочная ставка и срок':'Ставка и срок')+'</dt><dd>'+(x.estimate?'≈ ':'')+F.pct(x.rate)+' · '+F.years(x.years)+'</dd><dt>Стоимость квартиры после скидки</dt><dd>'+F.rub(r.price)+'</dd><dt>Первоначальный взнос</dt><dd>'+F.rub(r.down)+'</dd><dt>Общий кредит</dt><dd>'+F.rub(r.total)+'</dd></dl>';
    function stagePeriod(i){
      var date=r.stages[i].date,next=r.stages[i+1];
      if(!date){
        if(x.lastMonthsBeforeCommissioning)return beforeText(x);
        if(x.lastMonth)return monthText(x.lastMonth)+' · день уточняется';
        return 'До '+showDate(x.maxDate)+' включительно';
      }
      return 'С '+showDate(date)+(next&&next.date?' — до '+showDate(next.date):next?'':' и далее');
    }
    r.stages.forEach(function(s,i){
      html+='<div class="sm-stage"><div class="sm-stage-heading"><strong>'+(i===r.stages.length-1?(r.stages.length===2?'2-й (остаток)':'Последний'):(i+1)+'-й')+' транш</strong><span class="sm-stage-date">'+stagePeriod(i)+'</span></div><div class="sm-stage-metrics"><div><span>Сумма транша</span><b>'+F.rub(s.amount)+'</b></div><div><span>Всего выдано</span><b>'+F.rub(s.issued)+'</b></div><div><span>Платёж в месяц</span><b class="sm-stage-payment">'+F.rub(s.payment)+'</b></div></div></div>';});
    if(x.estimate)html+='<div class="sm-note">Предварительно по ориентиру: '+F.rub(selected.referencePayment)+' в месяц на '+F.rub(referencePrincipal())+' на '+selected.referenceYears+' лет. Из него получена расчётная ставка ≈ '+F.pct(x.rate)+'. Все платежи ориентировочные.</div>';
    html+='<div class="sm-note">Аннуитет считается от суммы выданных траншей на исходный срок '+F.years(x.years)+'. Уменьшение долга между траншами, неполные месяцы и изменение срока не учитываются. Точный график предоставит банк.</div>';

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
  U.moneyInput($('sm-first-rub'),render);
  $('sm-first-date').addEventListener('input',render);
  $('sm-add-draw').addEventListener('click',addDraw);
  $('sm-commissioning').addEventListener('input',function(){syncCommissioning();render();});
  var previousDeal;
  el.date1.addEventListener('input',function(){if(selected){if(selected.flexibleTranches&&$('sm-first-date').value===previousDeal)$('sm-first-date').value=el.date1.value;previousDeal=el.date1.value;if(selected.secondMonths)el.date2.value=calc.addMonths(el.date1.value,selected.secondMonths);setProgramDiscount();updateProgramInfo();}render();});
  el.date1.value=previousDeal=iso(new Date());el.date2.value='';
  $('sm-print').addEventListener('click',function(){window.print();});
  U.saveButton($('sm-save'),$('sm-msg'),function(){
    if(!last)return Promise.resolve(null);
    var x=last.x,details=el.result.innerHTML,meta=project+(flats.selectedNumber()?' · кв. '+flats.selectedNumber():'')+' · '+U.stamp();
    return U.makePdf(function(png){var page=U.page(U.reportHead('Траншевая ипотека',meta,png)+'<section class="sm-card">'+details+'</section><p class="sm-legal">Предварительный расчёт. Окончательные условия и график определяет банк.</p>','portrait');return {pages:[page],file:'Траншевая ипотека '+project+' '+new Date().toLocaleDateString('ru-RU')};},'portrait');
  });
  setupProgram();
})();
