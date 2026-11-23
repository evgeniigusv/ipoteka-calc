/* Ипотечный калькулятор: страница. Расчёт — в engine.js, данные — в data.js. */
(async function () {
  'use strict';
  var C = window.SMCalc, U = window.SMUi, F = C.fmt, esc = U.esc;

  var CONFIG = Object.assign({
    // true — показывать внутренние цифры: комиссию банку и профицит. Включается и адресом: index.html?internal=1
    showInternal: /[?&]internal=1/.test(location.search),
    defaultPrice: 10000000
  }, window.SM_CALC_CONFIG || {});

  if(window.SM_TOOLS_READY)await window.SM_TOOLS_READY;
  else if(window.SM_MORTGAGE_READY)await window.SM_MORTGAGE_READY;
  var D = C.buildData(window.SM_DATA);
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    project: $('sm-project'), flat: $('sm-flat'), price: $('sm-price'), disc: $('sm-disc'), type: $('sm-type'),
    kidsField: $('sm-kids-field'), kids: $('sm-kids'), pv: $('sm-pv'), term: $('sm-term'),
    detail: $('sm-detail'), title: $('sm-table-title'), tip: $('sm-tip'), thead: $('sm-thead'), tbody: $('sm-tbody'),
    updated: $('sm-rate-status'), companyPays: $('sm-company-pays'), promotions: $('sm-promotions')
  };
  var state = { project: D.projects[0], type: D.types[0], pick: null, promotionIds: [] };
  function catalogDiscount(){return C.cashDiscount(D,state.project);}
  var last = null; // последний расчёт — из него собирается PDF

  function readInputs() {
    var term = parseFloat(String(el.term.value).replace(',', '.'));
    return {
      project: state.project, type: state.type, kids: el.kids.value,
      base: U.parseMoney(el.price.value) || 0, disc: U.parsePct(el.disc.value), cash: flats.cashPrice(), pv: U.parseMoney(el.pv.value),
      term: isFinite(term) && term > 0 ? term : null, pick: state.pick,
      companyPays: el.companyPays.checked, compensationLimit: C.compensationLimit(D,state.project), promotionIds: state.promotionIds
    };
  }

  function hasKids() { return !el.kidsField.hidden; }
  function setupKids() {
    var opts = C.kidsOptions(D, state.project, state.type), cur = el.kids.value;
    el.kidsField.hidden = !opts.length;
    el.kids.innerHTML = opts.map(function (k) { return '<option' + (k === cur ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('');
  }
  function promotionOptions() {
    var programs=D.programs.filter(function(p){return (!p.projects.length||p.projects.indexOf(state.project)>=0)&&p.type===state.type&&(!p.kids||p.kids===el.kids.value);});
    var available=D.promotions.filter(function(a){return programs.some(function(p){return C.compatiblePromotions(D,p,state.project).some(function(v){return v.id===a.id;});});});
    state.promotionIds=state.promotionIds.filter(function(id){return available.some(function(a){return a.id===id;});});
    el.promotions.innerHTML=available.map(function(a){return '<label class="sm-check"><input type="checkbox" data-promotion="'+esc(a.id)+'"'+(state.promotionIds.indexOf(a.id)>=0?' checked':'')+'><span>'+esc(a.name)+(a.percent!=null?' · '+F.pct(a.percent):' · информационная акция')+'</span></label>';}).join('');
    $('sm-promotions-field').hidden=!available.length;
    $('sm-company-field').hidden=!programs.some(function(p){return p.sub>0;});
    var limit=C.compensationLimit(D,state.project);
    $('sm-company-hint').textContent=limit==null?'Лимит компенсации не задан в инструментах. До его настройки компенсация не учитывается.':'До '+F.pct(limit)+' акционной стоимости. Сумма сверх лимита включается в цену квартиры.';
  }

  /* ---------- Расчёт выбранной программы ---------- */
  function detailHtml(inp, r) {
    var grace = r.graceMonths > 0, rows = [], source = D.programs.find(function(p){return p.id===r.id;});
    var add = function (k, v, cls) {
      var c = cls ? ' class="' + cls + '"' : '';
      rows.push('<dt' + c + '>' + k + '</dt><dd' + c + '>' + v + '</dd>');
    };
    var dim = function (t) { return ' <span class="sm-dim">· ' + t + '</span>'; };
    add(grace ? 'Ставка в льготный период' : 'Ставка', F.pct(r.r1));
    if (grace) { add('Ставка после льготного периода', F.pct(r.r2)); add('Льготный период', F.period(r.graceMonths)); }
    add('Срок кредита', F.years(r.term));
    add('Цена по прайсу', F.rub(inp.base));
    add('Акционная стоимость', F.rub(r.cashPrice));
    if(r.sub>0){add(inp.companyPays ? 'Компенсация компании' : 'Компенсация компании выключена', F.rub(r.companyCompensation));add('Доплата клиента за субсидию', F.rub(r.clientSubsidy));}
    if(r.promotions.length)add('Применённые акции',r.promotions.map(function(a){return esc(a.name);}).join(', '));
    add('Цена квартиры в договоре', F.rub(r.price), 'sm-strong');
    add('Скидка', F.rub(inp.base - r.price) + dim(F.pct1(r.disc)));
    add('Первоначальный взнос', F.rub(r.pv) + dim(F.pct1(r.pvShare) + ' прайса'), 'sm-strong');
    add('Сумма кредита', F.rub(r.loan), 'sm-strong');
    add('Переплата по процентам', F.rub(r.over));
    add('Всего выплат банку', F.rub(r.total));
    if (CONFIG.showInternal) { // sm-int — только на экране: в печать и PDF для клиента не попадает
      add('Комиссия банку', F.rub(r.subsidy) + dim(F.pct(r.sub) + ' кредита'), 'sm-int');
      add('Профит', F.rub(r.surplus), 'sm-int');
    }
    var flat = flats.selectedNumber();
    return '<div class="sm-hero">' +
        '<div class="sm-hero-name">' + esc(inp.type + ', ' + r.name) + '</div>' +
        '<div class="sm-hero-flat">' + esc(inp.project) + (hasKids() ? ' · ' + esc(inp.kids) : '') + (flat ? ' · кв. ' + esc(flat) : '') + '</div>' +
        '<div class="sm-pay">' +
          '<div><div class="sm-k">' + (grace ? 'Платёж первые ' + F.period(r.graceMonths) : 'Ежемесячный платёж') + '</div><div class="sm-v">' + F.rub(r.pay1) + '</div></div>' +
          (grace ? '<div><div class="sm-k">Платёж после</div><div class="sm-v sm-v2">' + F.rub(r.pay2) + '</div></div>' : '') +
        '</div></div>' +
      '<dl>' + rows.join('') + '</dl>' +
      '<div class="sm-note">Комиссия банку и платёж считаются от окончательного кредита: цена ДДУ за вычетом взноса. Доплата за субсидию включена в цену ДДУ.</div>' +
      (r.compensationWarning?'<div class="sm-note sm-why">'+esc(r.compensationWarning)+'</div>':'')+
      (source && source.sub>0 && r.term<source.maxTerm ? '<div class="sm-note">Срок сокращён; ставка и комиссия взяты из программы на '+F.years(source.maxTerm)+'. Подтвердите их у банка для выбранного срока.</div>' : '') +
      (r.note ? '<div class="sm-note">' + esc(r.note) + '</div>' : '');
  }

  /* ---------- Таблица программ ---------- */
  var sub = function (t, cls) { return '<span class="sm-sub' + (cls ? ' ' + cls : '') + '">' + t + '</span>'; };
  var COLS = [
    ['Программа', function (r) { return esc(r.name) + (r.ok ? '' : sub(esc(r.note || r.status), 'sm-why')); }],
    ['Ставка', function (r) { return F.pct(r.r1) + (r.graceMonths ? sub('через ' + F.period(r.graceMonths) + ' — ' + F.pct(r.r2)) : ''); }],
    ['Срок', function (r) { return F.years(r.term); }],
    ['Цена в договоре', function (r) { return F.rub(r.price) + sub('скидка ' + F.pct1(r.disc)); }, true],
    ['Первый взнос', function (r) { return F.rub(r.pv) + sub(F.pct1(r.pvShare) + ' прайса'); }, true],
    ['Кредит', function (r) { return F.rub(r.loan); }, true],
    ['Платёж в месяц', function (r) { return '<b>' + F.rub(r.pay1) + '</b>' + (r.graceMonths ? sub('далее ' + F.rub(r.pay2)) : ''); }, true],
    ['Переплата', function (r) { return F.rub(r.over); }, true]
  ];
  if (CONFIG.showInternal) COLS.push(['Комиссия банку', function (r) { return F.rub(r.subsidy) + sub(F.pct(r.sub) + ' кредита'); }, true, 'sm-int']);

  // Колонка: название, содержимое, «только для подходящих» (у неподходящей программы — прочерк), класс ячейки
  function cls(c) { return c[3] ? ' class="' + c[3] + '"' : ''; }
  function rowHtml(r, selId) {
    return '<tr data-id="' + r.id + '" class="' + (r.ok ? 'sm-pick' : 'sm-off') + (r.id === selId ? ' sm-sel' : '') + '"' + (r.id === selId ? ' aria-current="true"' : '') + (r.ok ? ' tabindex="0"' : '') + '>' +
      COLS.map(function (c) { return '<td data-l="' + c[0] + '"' + cls(c) + '>' + (c[2] && !r.ok ? '—' : '<span>' + c[1](r) + '</span>') + '</td>'; }).join('') + '</tr>';
  }
  function headHtml() { return '<tr>' + COLS.map(function (c) { return '<th' + cls(c) + '>' + c[0] + '</th>'; }).join('') + '</tr>'; }

  function render() {
    promotionOptions();
    var inp = readInputs();
    if (flats.isPif()) { el.detail.innerHTML = '<p class="sm-empty">Для квартиры ПИФ условия покупки нужно уточнить. Расчёт отключён.</p>'; el.thead.innerHTML = el.tbody.innerHTML = el.tip.innerHTML = ''; last = null; return; }
    el.title.textContent = inp.type + (hasKids() ? ', ' + inp.kids : '') + ': все программы';
    if (!inp.base) {
      el.detail.innerHTML = '<p class="sm-empty">Укажите стоимость квартиры.</p>';
      el.thead.innerHTML = el.tbody.innerHTML = el.tip.innerHTML = '';
      last = null;
      return;
    }
    if(!el.disc.value.trim()){el.detail.innerHTML='<p class="sm-empty">Укажите скидку при полной оплате. Если скидки нет, введите 0.</p>';el.thead.innerHTML=el.tbody.innerHTML=el.tip.innerHTML='';last=null;return;}
    if(inp.disc>=1 || (el.term.value && !(Number.isInteger(Number(el.term.value))&&Number(el.term.value)>=1&&Number(el.term.value)<=30))){el.detail.innerHTML='<p class="sm-empty">Скидка должна быть меньше 100%, срок — целое число от 1 до 30 лет.</p>';el.thead.innerHTML=el.tbody.innerHTML=el.tip.innerHTML='';last=null;return;}
    var res = C.mortgage(D, inp);
    if (state.pick != null && !res.picked) state.pick = null; // выбранная вручную перестала подходить — снова автоподбор
    last = { inp: inp, res: res };
    renderSelection(inp, res);
    el.thead.innerHTML = res.rows.length ? headHtml() : '';
    el.tbody.innerHTML = res.rows.map(function (r) { return rowHtml(r, res.best && res.best.id); }).join('');
  }

  function renderSelection(inp, res) {
    el.detail.innerHTML = res.best ? detailHtml(inp, res.best)
      : '<p class="sm-empty">' + (res.rows.length ? 'При таких условиях ни одна программа не подходит. Измените скидку, взнос или тип ипотеки.' : 'Условия ипотеки для этого проекта готовятся.') + '</p>';
    if (res.best) U.resultIssued(el.detail);
    renderTip(inp, res);
  }

  function renderTip(inp, res) {
    el.tip.innerHTML = !res.best ? ''
      : state.pick != null ? 'Программа выбрана вручную · <button type="button" class="sm-link" id="sm-auto">вернуть автоподбор</button>'
      : (inp.pv > 0
          ? (res.best.pvRaised ? 'Взноса не хватает для доступных программ. Показан вариант с минимальным первым платежом после увеличения взноса.' : 'Минимальный первый платёж среди программ, для которых хватает вашего взноса.')
          : 'Сначала отобраны программы с наименьшей долей взноса или в пределах 0,5 п. п. от неё. Из них показана программа с минимальным первым платежом.');
  }

  /* ---------- PDF: лист 1 — условия и расчёт, дальше — таблица программ по 12 строк ---------- */
  function buildReport(png) {
    var inp = last.inp, res = last.res, flat = flats.selectedNumber(), facts = [];
    var add = function (k, v, strong) {
      var c = strong ? ' class="sm-strong"' : '';
      facts.push('<dt' + c + '>' + k + '</dt><dd' + c + '>' + v + '</dd>');
    };
    add('Проект', esc(inp.project));
    if (flat) add('Номер квартиры', esc(flat));
    add('Стоимость квартиры по прайсу', F.rub(inp.base), true);
    add('Скидка', F.pct(inp.disc));
    add('Компания оплачивает субсидию',inp.companyPays?(inp.compensationLimit==null?'Лимит не задан, компенсация не учтена':'Да, до '+F.pct(inp.compensationLimit)+' акционной стоимости'):'Нет');
    add('Тип ипотеки', esc(inp.type));
    if (hasKids()) add('Количество детей', esc(inp.kids));
    add('Первоначальный взнос', inp.pv ? F.rub(inp.pv) : 'минимальный');
    add('Срок', inp.term ? F.years(inp.term) : 'максимальный');

    var meta = inp.project + (flat ? ' · кв. ' + flat : '') + ' · ' + U.stamp();
    var legal = '<p class="sm-legal">' + esc($('sm-legal').textContent) + '</p>';
    var pages = [U.page(U.reportHead('Расчёт ипотеки', meta, png) +
      '<div class="sm-grid">' +
        '<section class="sm-card"><h2>Условия</h2><dl>' + facts.join('') + '</dl></section>' +
        '<section class="sm-card"><h2>Расчёт по программе</h2>' + el.detail.innerHTML + '</section>' +
      '</div>' + legal, 'landscape')];
    var rows = res.rows.filter(function (r) { return r.ok; }), PER = 12;
    for (var k = 0; k < rows.length; k += PER) {
      pages.push(U.page('<section class="sm-card"><h2>' + esc(el.title.textContent) + (k ? ' (продолжение)' : '') + '</h2>' +
        '<table><thead>' + headHtml() + '</thead><tbody>' +
        rows.slice(k, k + PER).map(function (r) { return rowHtml(r, res.best.id); }).join('') + '</tbody></table></section>' + legal, 'landscape'));
    }
    return { pages: pages, file: 'Расчёт ипотеки ' + inp.project + (flat ? ' кв ' + flat : '') + ' ' + new Date().toLocaleDateString('ru-RU') };
  }
  function createPdf() { return last && last.res.best ? U.makePdf(buildReport, 'landscape') : Promise.resolve(null); }

  var flats = window.SMFlats.setup({ select: el.flat, info: $('sm-flat-info'), price: el.price, rooms: el.rooms,
    discount: el.disc, project: state.project, onChange: function () { render(); } });

  /* ---------- Запуск ---------- */
  var asItems = function (list) { return list.map(function (x) { return { value: x, label: x }; }); };
  U.pills(el.project, asItems(D.projects), state.project, 'v');
  // На кнопках — без слова «ипотека»: оно уже есть в подписи поля
  U.pills(el.type, D.types.map(function (t) { return { value: t, label: t.replace(/[\s-]ипотека$/i, '') }; }), state.type, 'v');
  el.price.value = F.int(CONFIG.defaultPrice);
  el.disc.value = String(+(catalogDiscount() * 100).toFixed(2)).replace('.', ',');
  function updateRateStatus(){
    var status=window.SM_MORTGAGE_STATUS||{fallback:true};
    var rate=status.byProject ? status.byProject[state.project] : status;
    el.updated.textContent=rate.message || (rate.fallback
      ? 'Не удалось загрузить обновления. Показана резервная копия ставок от '+window.SM_DATA.updated+'. Перезагрузите страницу перед расчётом.'
      : 'Ставки и комиссии проверены '+new Date(rate.checkedAt).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' (Екатеринбург). Обновление каждые 3 часа.'+(rate.stale?' Проверка задерживается — подтвердите актуальность условий.':''));
    el.updated.classList.toggle('sm-why',rate.fallback || rate.stale);
  }
  updateRateStatus();
  setupKids();

  var pickPill = function (box, key) {
    U.onPill(box, 'v', function (v, btn) {
      state[key] = v; state.pick = null;
      if (key === 'project') { updateRateStatus(); flats.setProject(v); el.disc.value=String(+(catalogDiscount()*100).toFixed(2)).replace('.',','); $('sm-pv-hint').textContent=(v==='ДНК — 2 очередь'?'От 20%':'От 20,1%')+' цены по прайсу. Недостаточный взнос увеличивается до минимального.'; }
      Array.prototype.forEach.call(box.children, function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      setupKids();
      render();
    });
  };
  pickPill(el.project, 'project');
  pickPill(el.type, 'type');
  U.moneyInput(el.price, render);
  U.moneyInput(el.pv, render);
  U.pctInput(el.disc, render);
  el.term.addEventListener('input', render);
  el.kids.addEventListener('change', function (e) { render(); U.programFeedback(e); });
  el.companyPays.addEventListener('change',render);
  el.promotions.addEventListener('change',function(e){var id=e.target.getAttribute('data-promotion');if(!id)return;state.promotionIds=state.promotionIds.filter(function(v){return v!==id;});if(e.target.checked)state.promotionIds.push(id);render();});

  var pick = function (e) {
    var tr = e.target.closest('tr.sm-pick');
    if (!tr || !last) return;
    if (state.pick === +tr.dataset.id) {
      U.programFeedback(e, true);
      return;
    }
    const selected = last.res.rows.find(row => row.ok && row.id === +tr.dataset.id);
    if (!selected) return;
    const repeat = selected === last.res.best;
    state.pick = last.inp.pick = selected.id;
    last.res.best = selected;
    last.res.picked = true;
    U.changeProgram(el.tbody, tr, e, () => {
      U.markProgram(tr);
      if (repeat) renderTip(last.inp, last.res);
      else renderSelection(last.inp, last.res);
    });
    U.programFeedback(e, repeat);
  };
  el.tbody.addEventListener('click', pick);
  el.tbody.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
  el.tip.addEventListener('click', function (e) {
    if (e.target.id !== 'sm-auto') return;
    U.changeProgram(el.tbody, el.tip, e, () => { state.pick = null; render(); });
    el.tbody.querySelector('tr.sm-sel')?.focus({preventScroll:true});
    U.programFeedback(e);
  });
  $('sm-print').addEventListener('click', function () { window.print(); });
  U.saveButton($('sm-save'), $('sm-msg'), createPdf);

  window.SMIpoteka = { createPdf: createPdf, data: D };
  render();
})();
