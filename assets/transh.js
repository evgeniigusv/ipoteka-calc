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
  var daDates={'ДА — 1 очередь':'2027-03-20','ДА — 2 очередь':'2028-09-20'};
  var daReferenceRate=calc.rateFromPayment(100000,1500,30);
  function isDaEstimate(){return project!=='ДНК — 2 очередь'&&el.program.value==='da-reference';}
  function pad(n){return String(n).padStart(2,'0');}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function localDate(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);}
  function addYear(s){var d=localDate(s),day=d.getDate();d.setDate(1);d.setFullYear(d.getFullYear()+1);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d);}
  function showDate(s){return localDate(s).toLocaleDateString('ru-RU');}
  function startDiscount(date){return !!date && date <= '2026-11-30';}
  function setProgramDiscount(){if(selected) el.discount.value=String(selected.discount+(startDiscount(el.date1.value)?2:0));}
  function updateProgramInfo(){
    if(!selected)return;
    el.info.textContent='Сбербанк: ставка 19,2%, срок до 30 лет. Скидка '+selected.discount+'%'+(startDiscount(el.date1.value)?' + 2% на старте (до 30.11.2026)':' (стартовая скидка 2% действует до 30.11.2026)')+'. Скидку можно изменить.';
  }
  function setupProgram(){
    var dnk=project==='ДНК — 2 очередь';
    el.program.innerHTML=dnk?programs.map(function(p){return '<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join(''):'<option value="da-reference">ДА · расчёт по ориентиру 1 500 ₽</option><option value="manual">ДА · по точной ставке банка</option>';
    el.date2.value=dnk&&el.date1.value?addYear(el.date1.value):daDates[project];
    applyProgram();
  }
  function applyProgram(){
    var dnk=project==='ДНК — 2 очередь';
    selected=dnk?programs.find(function(p){return p.id===el.program.value;}):null;
    el.bank.value=dnk?'Сбербанк':'';el.rate.value=selected?String(selected.rate).replace('.',','):isDaEstimate()?String(+(daReferenceRate*100).toFixed(2)).replace('.',','):'';
    el.rate.readOnly=isDaEstimate();
    $('sm-rate-label').textContent=isDaEstimate()?'Расчётная ставка, %':'Ставка, % годовых';
    $('sm-rate-hint').textContent=isDaEstimate()?'Восстановлена из 1 500 ₽ в месяц на 100 000 ₽ при сроке 30 лет. Это оценка, не ставка банка.':'Ставка банка для выбранной программы.';
    el.first.value=selected?String(selected.first):'';el.second.value=selected?String(selected.second):'';
    $('sm-da-tranches').hidden=dnk; $('sm-dnk-tranches').hidden=!dnk; $('sm-dnk-stage-hint').hidden=!dnk; $('sm-third-date').hidden=!dnk;
    el.discount.value='0';setProgramDiscount();el.pv.value=dnk?'20':'20,1';
    if(dnk)updateProgramInfo();else el.info.textContent='Первый транш — 100 000 ₽, второй — весь остаток кредита. Первоначальный взнос от 20,1%.'+(isDaEstimate()?' При сроке 30 лет первый платёж — около 1 500 ₽. При другом сроке платёж пересчитывается по оценочной ставке.':' Введите подтверждённую ставку банка для расчёта платежей.');
    el.dateHint.textContent=dnk?'В инструментах указан май 2029 года, но ввод дома — IV квартал 2029. Уточните дату у банка.':'';
    $('sm-date2-hint').textContent=dnk?'Через год после сделки; дату можно изменить.':('По условиям ДА — '+showDate(daDates[project])+'. При необходимости дату можно изменить.');
    render();
  }
  function read(){
    var base=U.parseMoney(el.price.value)||0, discount=U.parsePct(el.discount.value);
    return {base:base,discount:discount,price:Math.round(base*(1-discount)),down:U.parsePct(el.pv.value),rate:isDaEstimate()?daReferenceRate:U.parsePct(el.rate.value),estimate:isDaEstimate(),years:Number(el.term.value),first:U.parsePct(el.first.value),second:U.parsePct(el.second.value),date1:el.date1.value,date2:el.date2.value,date3:el.date3.value||(selected?'2029-05-01':''),date3Approx:!!selected&&!el.date3.value,minFirst:selected?selected.minFirst||0:0,tranches:selected?3:2,firstRub:selected?null:100000,bank:el.bank.value.trim()};
  }
  function results(x,r){
    var html='<div class="sm-hero"><div class="sm-hero-name">'+esc(x.bank||'Траншевая ипотека')+'</div><div class="sm-hero-flat">'+esc(project)+(flats.selectedNumber()?' · кв. '+esc(flats.selectedNumber()):'')+'</div><div class="sm-pay"><div><div class="sm-k">Платёж после первого транша</div><div class="sm-v">'+F.rub(r.stages[0].payment)+'</div></div></div></div>';
    html+='<dl><dt>Программа</dt><dd>'+esc(selected ? selected.name.replace('Сбербанк · ', '') : x.estimate?'По ориентиру 1 500 ₽':'По ставке банка')+'</dd><dt>'+(x.estimate?'Оценочная ставка и срок':'Ставка и срок')+'</dt><dd>'+(x.estimate?'≈ ':'')+F.pct(x.rate)+' · '+F.years(x.years)+'</dd><dt>Стоимость квартиры после скидки</dt><dd>'+F.rub(r.price)+'</dd><dt>Первоначальный взнос</dt><dd>'+F.rub(r.down)+'</dd><dt>Общий кредит</dt><dd>'+F.rub(r.total)+'</dd></dl>';
    function stageDate(s){return x.date3Approx&&s===x.date3?'мая 2029 (день уточняется)':showDate(s);}
    r.stages.forEach(function(s,i){var end=i<r.stages.length-1?' — до '+stageDate(r.stages[i+1].date):' и далее';
      html+='<div class="sm-stage"><div class="sm-stage-heading"><strong>'+(i===r.stages.length-1?(r.stages.length===2?'2-й (остаток)':'Последний'):(i+1)+'-й')+' транш</strong><span class="sm-stage-date">с '+stageDate(s.date)+end+'</span></div><div class="sm-stage-metrics"><div><span>Сумма транша</span><b>'+F.rub(s.amount)+'</b></div><div><span>Всего выдано</span><b>'+F.rub(s.issued)+'</b></div><div><span>Платёж в месяц</span><b class="sm-stage-payment">'+F.rub(s.payment)+'</b></div></div></div>';});
    if(x.estimate)html+='<div class="sm-note">Предварительно по ориентиру: 1 500 ₽ в месяц за первый транш 100 000 ₽ на 30 лет. Из него получена расчётная ставка ≈ '+F.pct(x.rate)+'. Платёж после второго транша тоже оценочный; это не предложение банка.</div>';
    html+='<div class="sm-note">Аннуитет считается от суммы выданных траншей на исходный срок '+F.years(x.years)+'. Уменьшение долга между траншами, неполные месяцы и изменение срока не учитываются. Точный график предоставит банк.</div>';
    if(x.date3Approx)html+='<div class="sm-note">В инструментах последний транш указан на май 2029 года, а ввод дома — на IV квартал 2029 года. Дату транша необходимо уточнить у банка.</div>';
    if(selected&&selected.id==='sber1')html+='<div class="sm-note">Первый транш — не менее 100 000 ₽. Последний транш рассчитан как остаток кредита.</div>';
    if(project==='ДНК — 2 очередь' && x.date3.slice(0,7)!=='2029-05')html+='<div class="sm-note">В документе для ДНК-2 последний транш указан на май 2029 года. Проверьте выбранную дату с банком.</div>';
    return html;
  }
  function render(){var x=read();last=null;$('sm-save').disabled=true;
    if(!x.base){el.result.innerHTML='<p class="sm-empty">Выберите квартиру или укажите её стоимость.</p>';return;}
    if(project!=='ДНК — 2 очередь'&&x.down<.201){el.result.innerHTML='<p class="sm-empty">Для ДА в источнике указан первоначальный взнос от 20,1%.</p>';return;}
    try{var r=calc.calculate(x);el.result.innerHTML=results(x,r);last={x:x,r:r};$('sm-save').disabled=false;}
    catch(e){el.result.innerHTML='<p class="sm-empty">'+esc(e.message)+'</p>';}
  }
  var flats=window.SMFlats.setup({select:el.flat,info:$('sm-flat-info'),price:el.price,project:project,onChange:render});
  U.pills(el.project,projects.map(function(p){return {value:p,label:p};}),project,'v');
  U.onPill(el.project,'v',function(v,btn){project=v;flats.setProject(v);el.date2.value=v==='ДНК — 2 очередь'&&el.date1.value?addYear(el.date1.value):'';el.date3.value='';Array.prototype.forEach.call(el.project.children,function(b){b.setAttribute('aria-pressed',String(b===btn));});setupProgram();});
  el.program.addEventListener('change',applyProgram);U.moneyInput(el.price,render);
  [el.discount,el.rate,el.pv,el.first,el.second].forEach(function(e){U.pctInput(e,render);});
  [el.bank,el.term,el.date2,el.date3].forEach(function(e){e.addEventListener('input',render);});
  el.date1.addEventListener('input',function(){if(project==='ДНК — 2 очередь'&&el.date1.value){el.date2.value=addYear(el.date1.value);setProgramDiscount();updateProgramInfo();}render();});
  el.date1.value=iso(new Date());el.date2.value='';
  $('sm-print').addEventListener('click',function(){window.print();});
  U.saveButton($('sm-save'),$('sm-msg'),function(){
    if(!last)return Promise.resolve(null);
    var x=last.x,details=el.result.innerHTML,meta=project+(flats.selectedNumber()?' · кв. '+flats.selectedNumber():'')+' · '+U.stamp();
    return U.makePdf(function(png){var page=U.page(U.reportHead('Траншевая ипотека',meta,png)+'<section class="sm-card">'+details+'</section><p class="sm-legal">Предварительный расчёт. Окончательные условия и график определяет банк.</p>','portrait');return {pages:[page],file:'Траншевая ипотека '+project+' '+new Date().toLocaleDateString('ru-RU')};},'portrait');
  });
  setupProgram();
})();
