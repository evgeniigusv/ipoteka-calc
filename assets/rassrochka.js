/* Рассрочка: условия слева, выбранный расчёт справа, сравнение снизу. */
(async function () {
  'use strict';
  await (window.SM_TOOLS_READY||window.SM_INSTALLMENTS_READY);
  var C = window.SMCalc, U = window.SMUi, F = C.fmt, esc = U.esc;
  var D = C.buildData(window.SM_DATA), $ = function (id) { return document.getElementById(id); };
  var el = {project:$('sm-project'),flat:$('sm-flat'),price:$('sm-price'),rooms:$('sm-rooms'),extra:$('sm-extra'),date:$('sm-date'),
    detail:$('sm-detail'),options:$('sm-program-options'),thead:$('sm-thead'),tbody:$('sm-tbody'),tip:$('sm-tip'),promotions:$('sm-promotions')};
  var state = {project:D.projects[0],step:{},picks:{},promotionIds:[]}, last = null;

  let currentCards = [];
  var downRub=$('sm-down-rub');
  const downPct=$('sm-down-pct');
  let downUnit='rub';
  function syncDownPayment(base) {
    if (downUnit==='rub') {
      const amount=U.parseMoney(downRub.value);
      downPct.value=base>0 && amount!=null ? (amount/base*100).toLocaleString('ru-RU',{maximumFractionDigits:2}) : '';
      return;
    }
    const raw=downPct.value.trim().replace(/%$/, '').trim().replace(',', '.');
    const valid=/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) && Number(raw)<=100;
    downRub.value=valid && base>0 ? F.int(Math.round(base*Number(raw)/100)) : '';
    return !valid && downPct.value.trim() ? 'Укажите долю взноса от 0 до 100%.' : '';
  }
  function readInputs() {
    return {project:state.project,downRub:downRub.value.trim()?U.parseMoney(downRub.value):null,
      base:U.parseMoney(el.price.value)||0,rooms:+el.rooms.value,extra:U.parsePct(el.extra.value),step:state.step,promotionIds:state.promotionIds};
  }
  function dealDate() {
    if (!el.date.value || !el.date.validity.valid) return null;
    var date=new Date(el.date.value+'T00:00:00');
    return Number.isFinite(date.getTime())?date:null;
  }
  function discLabel(c) {
    if (!c.disc && !c.extra) return 'Без скидки';
    var own=F.pct0(c.disc);
    if (!c.extra) return 'Скидка '+own;
    if (!c.disc) return 'Доп. скидка '+F.pct0(c.extra);
    return 'Скидка '+own+(c.extraSequential?' и затем ':' + ')+F.pct0(c.extra);
  }
  function choice(label, attr, items, current) {
    return '<div class="sm-choice"><span class="sm-label">'+label+'</span><div class="sm-pills sm-sm" role="group" aria-label="'+label+'" data-'+attr+'>'+items.map(function(it){
      return '<button type="button" data-v="'+it.value+'" aria-pressed="'+(it.value===current)+'">'+esc(it.label)+'</button>';
    }).join('')+'</div></div>';
  }
  function optionsHtml(c) {
    var html='';
    if(c.steps)html+=choice('Периодичность платежей','step',c.steps.map(function(s){return {value:s.step,label:s.name};}),c.step);
    var program=D.installments.find(function(p){return p.id===c.id;});
    if(program.discFromPv>0)html+='<p class="sm-hint">До ПВ 71% скидка применяется к сумме взноса; указан её размер от прайса.</p>';
    html+='<p class="sm-hint">При ПВ от 71% включительно действует скидка при полной оплате. Отображаемые проценты округлены, суммы рассчитаны без округления скидки.</p>';
    return html?'<div class="sm-program-options"><div class="sm-options-name">'+esc(c.name)+'</div>'+html+'</div>':'';
  }
  function detailHtml(c) {
    var flat=flats.selectedNumber();
    if(c.error)return '<div class="sm-hero"><div class="sm-hero-name">'+esc(c.name)+'</div></div><p class="sm-empty">'+esc(c.error)+'</p>';
    var html='<div class="sm-hero"><div class="sm-hero-name">'+esc(c.name)+'</div><div class="sm-hero-flat">'+esc(state.project)+(flat?' · кв. '+esc(flat):'')+'</div><div class="sm-pay">'+
      '<div><div class="sm-k">Стоимость в договоре</div><div class="sm-v">'+F.rub(c.total)+'</div></div>'+
      (c.saved>0.5?'<div><div class="sm-k">Экономия от прайса</div><div class="sm-v sm-v2">'+F.rub(c.saved)+'</div></div>':'')+'</div></div>';
    html+='<dl><dt>Цена по прайсу</dt><dd>'+F.rub(readInputs().base)+'</dd><dt>Скидка</dt><dd>'+esc(discLabel(c).replace(/^Скидка /,''))+'</dd>'+
      '<dt class="sm-strong">Первоначальный взнос</dt><dd class="sm-strong">'+F.rub(c.rows[0].amount)+'<span class="sm-sub">'+(c.fullPayment?'100% стоимости договора':F.pct1(c.share)+(c.pvFromBase?' прайса':' цены в договоре'))+'</span></dd>'+
      '<dt>Срок рассрочки</dt><dd>'+F.months(c.termMonths)+'<span class="sm-sub">до '+F.dmy(c.end)+'</span></dd></dl>';
    html+='<div class="sm-schedule"><h3>График платежей</h3><table><thead><tr><th>Когда</th><th>Платёж</th><th>Сумма</th></tr></thead><tbody>'+
      c.rows.map(function(r){return '<tr><td>'+esc(r.when)+'</td><td>'+esc(r.label)+'<span class="sm-sub">'+esc(r.sub)+'</span></td><td>'+F.rub(r.amount)+'</td></tr>';}).join('')+'</tbody></table></div>';
    if(c.note)html+='<p class="sm-desc sm-program-note">'+esc(c.note)+'</p>';
    if(c.promotions.length)html+='<p class="sm-note">Применённые акции: '+c.promotions.map(function(a){return esc(a.name);}).join(', ')+'.</p>';
    if(c.cashDiscountApplied)html+='<p class="sm-note">Применена актуальная скидка при 100% оплате.</p>';
    if(c.pvLimit)html+='<p class="sm-note">'+esc(c.pvLimit)+'</p>';
    if(c.warning)html+='<p class="sm-note">'+esc(c.warning)+'</p>';
    return html;
  }
  var cols=['Программа','Стоимость в договоре','Первый взнос','Платежи','Погашение'];
  function rowHtml(c,selected) {
    var pay=c.fullPayment?'Полная оплата':c.payment?F.rub(c.payment)+(c.kind==='equal'?({1:' / месяц',2:' / 2 месяца',3:' / квартал',6:' / полгода',12:' / год'}[c.step]):' / месяц'):'По графику';
    var values=['<button type="button" class="sm-program-pick" aria-pressed="'+selected+'" aria-controls="sm-detail">'+esc(c.name)+'</button><span class="sm-sub'+(c.error?' sm-why':'')+'">'+esc(c.error||discLabel(c))+'</span>',
      c.error?'—':F.rub(c.total),c.error?'—':F.rub(c.rows[0].amount)+'<span class="sm-sub">'+(c.fullPayment?'100% стоимости договора':F.pct1(c.share)+(c.pvFromBase?' прайса':' цены в договоре'))+'</span>',c.error?'—':pay,F.dmy(c.end)];
    return '<tr class="sm-pick'+(selected?' sm-sel':'')+(c.error?' sm-off':'')+'"'+(selected?' aria-current="true"':'')+' data-id="'+c.id+'">'+values.map(function(v,i){return '<td data-l="'+cols[i]+'"><span>'+v+'</span></td>';}).join('')+'</tr>';
  }
  function empty(message, field, label) {
    currentCards = [];
    last=null;U.emptyResult(el.detail,message,field,label);
    el.options.innerHTML=el.thead.innerHTML=el.tbody.innerHTML='';el.tip.textContent=message;$('sm-save').disabled=true;
  }
  function render() {
    var programs=D.installments.filter(function(p){return !p.projects.length||p.projects.indexOf(state.project)>=0;});
    var available=D.promotions.filter(function(a){return programs.some(function(p){return C.compatiblePromotions(D,p,state.project).some(function(v){return v.id===a.id;});});});
    state.promotionIds=state.promotionIds.filter(function(id){return available.some(function(a){return a.id===id;});});
    el.promotions.innerHTML=available.map(function(a){return '<label class="sm-check"><input type="checkbox" data-promotion="'+esc(a.id)+'"'+(state.promotionIds.indexOf(a.id)>=0?' checked':'')+'><span>'+esc(a.name)+(a.percent!=null?' · '+F.pct0(a.percent):' · информационная акция')+'</span></label>';}).join('');
    $('sm-promotions-field').hidden=!available.length;
    $('sm-extra-field').hidden=programs.every(function(p){return Array.isArray(p.compatiblePromotions);});
    var status=window.SM_INSTALLMENTS_STATUS||{fallback:true};
    $('sm-updated').textContent=status.catalog?'Справочник: проверено '+new Date(status.checkedAt).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' · Екатеринбург. Условия из раздела «Инструменты».'+(status.stale?' Проверка задерживается; подтвердите условия.':''):state.project==='ДНК — 2 очередь'?'ДНК: сверено вручную '+window.SM_DATA.updated+'.':
      status.fallback?'ДА: резервная копия от '+(window.SM_DATA.daInstallmentsUpdated||window.SM_DATA.updated)+'. Обновлённые условия загрузить не удалось.':
      'ДА: проверено '+new Date(status.checkedAt).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+
      ' (Екатеринбург). Условия из раздела «Инструменты».'+(status.stale?' Проверка задерживается; подтвердите условия.':'');
    const downError=syncDownPayment(U.parseMoney(el.price.value));
    var inp=readInputs(),date=dealDate();
    if(!date)return empty('Укажите корректную дату сделки.',programs.length ? el.date : null,'Ввести дату');
    if(flats.isPif())return empty('Для квартиры ПИФ условия рассрочки нужно уточнить.');
    if(!inp.base)return empty('Укажите стоимость квартиры.',programs.length ? el.price : null,'Ввести цену');
    if(downError)return empty(downError);
    if(inp.downRub==null)return empty('Введите первоначальный взнос в рублях или процентах.',programs.length ? (downUnit==='pct' ? downPct : downRub) : null,'Ввести взнос');
    if(!Number.isSafeInteger(inp.downRub)||inp.downRub<0)return empty('Укажите корректный первоначальный взнос.');
    const cards = C.installments(D, inp, date);
    currentCards = cards;
    if(!cards.length)return empty('Условия рассрочки для этого проекта готовятся.');
    var selected=cards.find(function(c){return c.id===state.picks[state.project];})||cards.find(function(c){return !c.error;})||cards[0];
    showSelection(selected);
    el.thead.innerHTML='<tr>'+cols.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr>';
    el.tbody.innerHTML=cards.map(function(c){return rowHtml(c,c.id===selected.id);}).join('');
    el.tip.textContent='Выберите строку, чтобы посмотреть расчёт';
  }
  function showSelection(selected) {
    last = selected;
    el.detail.innerHTML = detailHtml(selected);
    if (!selected.error) U.resultIssued(el.detail);
    el.options.innerHTML = optionsHtml(selected);
    $('sm-save').disabled = !!selected.error;
  }
  function buildReport(png) {
    var inp=readInputs(),flat=flats.selectedNumber();
    var facts='<section class="sm-card"><div class="sm-facts"><div>Проект<b>'+esc(inp.project)+'</b></div>'+(flat?'<div>Квартира<b>'+esc(flat)+'</b></div>':'')+'<div>Дата сделки<b>'+F.dmy(dealDate())+'</b></div></div></section>';
    var page=U.page(U.reportHead('Расчёт рассрочки',inp.project+' · '+U.stamp(),png)+facts+'<section class="sm-card sm-installment-report">'+detailHtml(last)+'</section><p class="sm-legal">'+esc($('sm-legal').textContent)+'</p>','portrait');
    return {pages:[page],file:'Расчёт рассрочки '+inp.project+' '+last.name+' '+new Date().toLocaleDateString('ru-RU')};
  }
  function createPdf(){return last&&!last.error?U.makePdf(buildReport,'portrait'):Promise.resolve(null);}
  var flats=window.SMFlats.setup({select:el.flat,info:$('sm-flat-info'),price:el.price,rooms:el.rooms,discount:null,project:state.project,onChange:render});
  U.pills(el.project,D.projects.map(function(p){return {value:p,label:p};}),state.project,'v');
  var now=new Date();el.date.value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  el.price.value=F.int(10000000);
  U.onPill(el.project,'v',function(v,btn){state.project=v;flats.setProject(v);Array.prototype.forEach.call(el.project.children,function(b){b.setAttribute('aria-pressed',String(b===btn));});render();});
  el.tbody.addEventListener('click', function (event) {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    const selected = currentCards.find(card => card.id === +row.dataset.id);
    if (!selected) return;
    const button = row.querySelector('button');
    if (document.activeElement !== button) button.focus({preventScroll:true});
    state.picks[state.project] = selected.id;
    const repeat = last === selected;
    if (!repeat) {
      showSelection(selected);
      U.markProgram(row);
    }
    U.programFeedback(event, row, repeat);
  });
  el.options.addEventListener('click',function(e){var b=e.target.closest('[data-step] button[data-v]');if(!b||!last)return;var value=b.getAttribute('data-v');state.step[last.id]=+value;render();U.programFeedback(e);el.options.querySelector('[data-step] button[data-v="'+value+'"]').focus({preventScroll:true});});
  el.promotions.addEventListener('change',function(e){var id=e.target.getAttribute('data-promotion');if(!id)return;state.promotionIds=state.promotionIds.filter(function(v){return v!==id;});if(e.target.checked)state.promotionIds.push(id);render();});
  U.moneyInput(downRub,function(){downUnit='rub';render();});
  downPct.addEventListener('input',function(){downUnit='pct';render();});
  U.moneyInput(el.price,render);U.pctInput(el.extra,render);el.rooms.addEventListener('change',render);el.date.addEventListener('input',render);
  $('sm-print').addEventListener('click',function(){window.print();});U.saveButton($('sm-save'),$('sm-msg'),createPdf);
  window.SMRassrochka={createPdf:createPdf,data:D};render();
})();
