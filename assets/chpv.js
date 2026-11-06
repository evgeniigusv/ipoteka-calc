(async function () {
  'use strict';
  await window.SM_TOOLS_READY;
  var U = window.SMUi, F = window.SMCalc.fmt, calc = window.SMChpvCalc, esc = U.esc;
  var $ = function (id) { return document.getElementById(id); };
  var els = { project: $('sm-project'), flat: $('sm-flat'), price: $('sm-price'), cash: $('sm-cash'), program: $('sm-program'), client: $('sm-client'), ddu: $('sm-ddu'), result: $('sm-result') };
  var projects = window.SM_DATA.chpv ? window.SM_DATA.projects.filter(function(project){return window.SM_DATA.chpv.some(function(p){return p.projects.includes(project);});}) : ['ДА — 1 очередь', 'ДА — 2 очередь'];if(!projects.length)projects=['ДА — 1 очередь'];var project = projects[0];
  var programs = [
    ['Семейная ипотека, 1 ребёнок', 6000000, 15, .10], ['Семейная ипотека, 2 ребёнка', 8000000, 15, .08],
    ['Семейная ипотека, 3 ребёнка', 10000000, 15, .06], ['Семейная ипотека, 4 ребёнка', 10000000, 15, .04],
    ['Семейная ипотека, 5 и более детей', 10000000, 15, .02], ['IT-ипотека', 9000000, 30, .06]
  ];
  var defaults=programs;
  function setupPrograms(){programs=window.SM_DATA.chpv?window.SM_DATA.chpv.filter(function(p){return p.projects.includes(project);}).map(function(p){return [p.name,p.limit,p.years,p.rate,p];}):defaults;
  els.program.innerHTML = programs.map(function (p, i) { return '<option value="' + i + '">' + esc(p[0]) + '</option>'; }).join('');}
  setupPrograms();
  U.pills(els.project, projects.map(function (p) { return {value:p,label:p}; }), project, 'v');
  var flats = window.SMFlats.setup({ select: els.flat, info: $('sm-flat-info'), price: els.price, project: project,
    onClear: function () { els.cash.value = ''; els.ddu.value = ''; },
    onSelect: function (row) { var a = Number(row.action); els.cash.value = a > 0 ? F.int(a) : ''; },
    onChange: function () { render(); } });
  function inputs() {
    var p = programs[+els.program.value]||['',0,0,0,{}], settings=p[4]||{};
    return { base: U.parseMoney(els.price.value), cash: U.parseMoney(els.cash.value), client: U.parseMoney(els.client.value), ddu: U.parseMoney(els.ddu.value),
      minDown: settings.minDown==null?.201:settings.minDown, cost: settings.cost==null?(project === projects[0] ? .25 : .50):settings.cost, limit: p[1], years: p[2], rate: p[3], overRate: settings.overRate==null?.14:settings.overRate };
  }
  function render() {
    var x = inputs();
    if(!programs.length){els.result.innerHTML='<p class="sm-empty">Активных программ ЧПВ нет.</p>';return;}
    if (!x.base || !x.cash || x.client == null || !x.ddu) { els.result.innerHTML = '<p class="sm-empty">Укажите цену по прайсу, цену за наличные, средства клиента и цену ДДУ.</p>'; return; }
    var r;try{r=calc.calculate(x);}catch(e){els.result.innerHTML='<p class="sm-empty">'+esc(e.message)+'</p>';return;}
    var rows=[];
    function add(k,v) { rows.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); }
    add('Минимальный ПВ от прайса', F.rub(r.minimum)); add('Нехватка ПВ', F.rub(r.shortage));
    add('Сумма ПВ по ДДУ', F.rub(r.down)); add('Финансируемая сумма', F.rub(r.funded) + ' · ' + F.pct1(r.fundedPct));
    add('Стоимость денег', F.rub(r.cost) + ' · ' + F.pct(x.cost)); add('Удорожание в ДДУ', F.rub(r.rise));
    add('Недополученная прибыль', F.rub(r.profit)); add('Сумма кредита', F.rub(r.loan)); add('Сверхлимит', F.rub(r.excess));
    add('Расчётная ставка', F.pct(r.rate)); add('Ежемесячный платёж', F.rub(r.payment)); add('Комиссия агента', F.rub(r.agent));
    els.result.innerHTML = '<div class="sm-hero"><div class="sm-k">Вердикт по таблице</div><div class="sm-hero-name">' + esc(r.verdict) + '</div></div><dl>' + rows.join('') + '</dl>' +
      (r.funded < 0 ? '<div class="sm-note">Средства клиента превышают рассчитанный ПВ: проверьте ввод.</div>' : '') +
      (r.fundedPct > .5 ? '<div class="sm-note">Финансируется более 50% первоначального взноса. Проверьте допустимый предел: в активном листе таблицы этот предел не проверяется.</div>' : '') +
      (r.excess > 0 ? '<div class="sm-note">Как в таблице, платёж для сверхлимита рассчитан по '+F.pct(x.overRate)+' на всю сумму. Реальные условия комбо-ипотеки уточните у брокера.</div>' : '') +
      '<div class="sm-note">Вердикт повторяет лист «Расчёт ЧПВ»; справочная ставка и применимость условий требуют подтверждения.</div>';
  }
  U.onPill(els.project, 'v', function (v, btn) { project = v; setupPrograms(); flats.setProject(v); els.cash.value = ''; els.ddu.value = ''; Array.prototype.forEach.call(els.project.children, function (b) { b.setAttribute('aria-pressed', String(b === btn)); }); render(); });
  [els.price, els.cash, els.client, els.ddu].forEach(function (e) { U.moneyInput(e, render); });
  els.program.addEventListener('change', render);
  $('sm-suggest').addEventListener('click', function () { var x = inputs(); if (x.cash && x.client != null) { els.ddu.value = F.int(calc.suggested(x)); render(); } });
  $('sm-print').addEventListener('click', function () { window.print(); });
  render();
})();
