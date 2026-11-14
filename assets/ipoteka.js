/* Ипотечный калькулятор: страница. Расчёт — в engine.js, данные — в data.js. */
(async function () {
  'use strict';
  var C = window.SMCalc, U = window.SMUi, F = C.fmt, esc = U.esc;

  var CONFIG = Object.assign({
    // true — показывать внутренние цифры: комиссию банку и профицит. Включается и адресом: index.html?internal=1
    showInternal: /[?&]internal=1/.test(location.search),
    // true — показывать кредит и платёж от «прайс − ПВ», как в таблице «Калькулятор субсидирования»; false — от цены в договоре
    loanFromBase: false,
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
    updated: $('sm-rate-status')
  };
  var state = { project: D.projects[0], type: '', pick: null };
  function catalogDiscount(){var p=(window.SM_DATA.cashDiscounts||{})[state.project];if(!p)return D.defaultDiscount;var today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Yekaterinburg'});return p.percent+(p.launchUntil&&today<=p.launchUntil?(p.launchDiscount||0):0);}
  var last = null; // последний расчёт — из него собирается PDF

  function readInputs() {
    var term = parseFloat(String(el.term.value).replace(',', '.'));
    return {
      project: state.project, type: state.type, kids: el.kids.value,
      base: U.parseMoney(el.price.value) || 0, disc: U.parsePct(el.disc.value), cash: flats.cashPrice(), pv: U.parseMoney(el.pv.value),
      term: isFinite(term) && term > 0 ? term : null, pick: state.pick
    };
  }

  function setupKids() {
    var opts = C.kidsOptions(D, state.project, state.type), cur = el.kids.value;
    el.kidsField.hidden = !opts.length;
    el.kids.innerHTML = '<option value="">Все</option>' + opts.map(function (k) { return '<option' + (k === cur ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('');
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
        '<div class="sm-hero-name">' + esc(r.type + ', ' + r.name) + '</div>' +
        '<div class="sm-hero-flat">' + esc(inp.project) + (r.kids ? ' · ' + esc(r.kids) : '') + (flat ? ' · кв. ' + esc(flat) : '') + '</div>' +
        '<div class="sm-pay">' +
          '<div><div class="sm-k">' + (grace ? 'Платёж первые ' + F.period(r.graceMonths) : 'Ежемесячный платёж') + '</div><div class="sm-v">' + F.rub(r.pay1) + '</div></div>' +
          (grace ? '<div><div class="sm-k">Платёж после</div><div class="sm-v sm-v2">' + F.rub(r.pay2) + '</div></div>' : '') +
        '</div></div>' +
      '<dl>' + rows.join('') + '</dl>' +
      '<div class="sm-note">Комиссия банку считается от прайса за вычетом взноса; платёж — от цены ДДУ за вычетом взноса.</div>' +
      (source && source.sub>0 && r.term<source.maxTerm ? '<div class="sm-note">Срок сокращён; ставка и комиссия взяты из программы на '+F.years(source.maxTerm)+'. Подтвердите их у банка для выбранного срока.</div>' : '') +
      (r.note ? '<div class="sm-note">' + esc(r.note) + '</div>' : '');
  }

  /* ---------- Таблица программ ---------- */
  var sub = function (t, cls) { return '<span class="sm-sub' + (cls ? ' ' + cls : '') + '">' + t + '</span>'; };
  var COLS = [
    ['Программа', function (r) { return esc(r.name) + sub(esc([r.type, r.kids].filter(Boolean).join(' · '))) + (r.ok ? '' : sub(esc(r.note || r.status), 'sm-why')); }],
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
    return '<tr data-id="' + r.id + '" class="' + (r.ok ? 'sm-pick' : 'sm-off') + (r.id === selId ? ' sm-sel' : '') + '"' + (r.ok ? ' tabindex="0"' : '') + '>' +
      COLS.map(function (c) { return '<td data-l="' + c[0] + '"' + cls(c) + '>' + (c[2] && !r.ok ? '—' : '<span>' + c[1](r) + '</span>') + '</td>'; }).join('') + '</tr>';
  }
  function headHtml() { return '<tr>' + COLS.map(function (c) { return '<th' + cls(c) + '>' + c[0] + '</th>'; }).join('') + '</tr>'; }

  var allRates = $('sm-all-rates'), toggle = $('sm-rates-toggle'), summary = $('sm-summary');
  function setExpanded(open) {
    allRates.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Свернуть список ставок' : 'Показать все ставки';
  }

  function itConditions(label) {
    var model = window.SMToolsModel;
    var project = Object.keys(model.projects).find(key => model.projects[key] === state.project);
    var cards = (window.SM_TOOLS_DATA?.records || []).filter(record =>
      record.project === project && record.kind === 'info' && model.section(record) === 'mortgage'
      && record.enabled && !record.params.ownerOnly && model.mortgageBucket(record) === 'it');
    if (!cards.length) return '';
    var today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Yekaterinburg' }).format(new Date());
    var offers = cards.filter(record => !record.params.validUntil || record.params.validUntil >= today)
      .flatMap(model.mortgageOffers);
    var query = new URLSearchParams({ section: 'mortgage', project: project, mortgageType: 'it' });
    var link = '<a class="sm-link" href="tools.html?' + esc(query.toString()) + '">';
    if (!offers.length) return '<li><span>' + label + '</span>' + link + 'См. условия</a></li>';
    var rate = Math.min(...offers.map(offer => offer.rate));
    var banks = [...new Set(offers.filter(offer => offer.rate === rate).map(offer => offer.bank))];
    return '<li><span>' + label + '<small>' + esc(banks.join(', ')) + ' · ' + link +
      'Условия</a></small></span><strong>от ' + F.pct(rate) + '</strong></li>';
  }

  function renderOverview(rows) {
    var model = window.SMToolsModel, groups = new Map();
    Object.entries(model.mortgageTypes).forEach(function ([key, label]) {
      groups.set(key, { label: label, rows: [] });
    });
    rows.forEach(function (row) {
      var key = model.mortgageType(row) || row.type;
      if (!groups.has(key)) groups.set(key, { label: row.type, rows: [] });
      groups.get(key).rows.push(row);
    });
    var items = [];
    groups.forEach(function (group, key) {
      var label = esc(group.label);
      if (!group.rows.length && key === 'it' && (!state.type || state.type === group.label)) {
        var conditions = itConditions(label);
        if (conditions) {
          items.push(conditions);
          return;
        }
      }
      if (state.type && !group.rows.length) return;
      var eligible = group.rows.filter(function (row) { return row.ok; });
      if (!eligible.length) {
        var reason = group.rows.length ? 'Нет подходящих ставок' : 'Нет программ для расчёта';
        items.push('<li><span>' + label + '<small>' + reason + '</small></span><span>—</span></li>');
        return;
      }
      var minimum = Math.min(...eligible.map(function (row) { return row.r1; }));
      var banks = new Map();
      eligible.forEach(function (row) {
        if (row.r1 === minimum && !banks.has(row.bank)) banks.set(row.bank, row);
      });
      var links = Array.from(banks.values(), function (row) {
        return '<button type="button" class="sm-link" data-id="' + row.id + '" aria-label="'
          + esc('Расчёт: ' + group.label + ', ' + row.bank + ', ' + F.pct(row.r1) + ', ' + F.years(row.term))
          + '">' + esc(row.bank) + '</button>';
      });
      items.push('<li><span>' + label + '<small>' + links.join(' · ') +
        '</small></span><strong>от ' + F.pct(minimum) + '</strong></li>');
    });
    summary.innerHTML = items.join('') || '<li>Нет программ для расчёта</li>';
    toggle.hidden = !rows.length;
    if (!rows.length) setExpanded(false);
  }

  function clearResults(message) {
    el.detail.innerHTML = '<p class="sm-empty">' + esc(message) + '</p>';
    el.thead.innerHTML = el.tbody.innerHTML = el.tip.innerHTML = '';
    summary.innerHTML = '<li>' + esc(message) + '</li>';
    toggle.hidden = true;
    setExpanded(false);
    last = null;
  }

  function render() {
    var inp = readInputs();
    $('sm-overview-project').textContent = inp.project;
    if (flats.isPif()) return clearResults('Для квартиры ПИФ условия покупки нужно уточнить. Расчёт отключён.');
    if (!inp.base) return clearResults('Укажите стоимость квартиры.');
    if (!el.disc.value.trim()) return clearResults('Укажите скидку при полной оплате. Если скидки нет, введите 0.');
    if (inp.disc >= 1 || (el.term.value && !(Number.isInteger(Number(el.term.value)) && inp.term >= 1 && inp.term <= 30))) {
      return clearResults('Скидка должна быть меньше 100%, срок — целое число от 1 до 30 лет.');
    }
    el.title.textContent = [inp.type || 'Ипотека', inp.kids].filter(Boolean).join(', ') + ' · все ставки';
    var res = C.mortgage(D, inp, { loanFromBase: CONFIG.loanFromBase });
    if (state.pick != null && !res.picked) state.pick = null; // выбранная вручную перестала подходить — снова автоподбор
    last = { inp: inp, res: res };
    renderOverview(res.rows);
    el.detail.innerHTML = res.best ? detailHtml(inp, res.best)
      : '<p class="sm-empty">' + (res.rows.length ? 'При таких условиях ни одна программа не подходит. Измените скидку, взнос или тип ипотеки.' : 'Условия ипотеки для этого проекта готовятся.') + '</p>';
    el.thead.innerHTML = res.rows.length ? headHtml() : '';
    el.tbody.innerHTML = res.rows.map(function (r) { return rowHtml(r, res.best && res.best.id); }).join('');
    el.tip.innerHTML = !res.best ? ''
      : state.pick != null ? 'Программа выбрана вручную · <button type="button" class="sm-link" id="sm-auto">вернуть автоподбор</button>'
      : 'Показана программа с наименьшим платежом. Нажмите на строку, чтобы посмотреть другую';
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
    add('Тип ипотеки', esc(res.best.type));
    if (res.best.kids) add('Количество детей', esc(res.best.kids));
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
  var types = Array.from(new Set(D.types.concat(D.programs.map(function (p) { return p.type; }))));
  U.pills(el.type, [{ value: '', label: 'Все' }].concat(types.map(function (t) { return { value: t, label: t.replace(/[\s-]ипотека$/i, '') }; })), state.type, 'v');
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
  el.kids.addEventListener('change', render);

  toggle.addEventListener('click', function () {
    setExpanded(allRates.hidden);
    if (!allRates.hidden) el.title.focus();
  });
  function showProgram(id) {
    state.pick = id;
    render();
    $('sm-calculation').focus();
  }
  summary.addEventListener('click', function (e) {
    var button = e.target.closest('button[data-id]');
    if (button) showProgram(Number(button.dataset.id));
  });
  var pick = function (e) {
    var tr = e.target.closest('tr.sm-pick');
    if (tr) showProgram(Number(tr.dataset.id));
  };
  el.tbody.addEventListener('click', pick);
  el.tbody.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
  el.tip.addEventListener('click', function (e) { if (e.target.id === 'sm-auto') { state.pick = null; render(); } });
  $('sm-print').addEventListener('click', function () { window.print(); });
  U.saveButton($('sm-save'), $('sm-msg'), createPdf);

  window.SMIpoteka = { createPdf: createPdf, data: D };
  render();
})();
