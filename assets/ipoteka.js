/* Ипотечный калькулятор: страница. Расчёт — в engine.js, данные — в data.js. */
(function () {
  'use strict';
  var C = window.SMCalc, U = window.SMUi, F = C.fmt, esc = U.esc;

  var CONFIG = Object.assign({
    // true — показывать внутренние цифры: комиссию банку и профицит. Включается и адресом: index.html?internal=1
    showInternal: /[?&]internal=1/.test(location.search),
    // true — показывать кредит и платёж от «прайс − ПВ», как в таблице «Калькулятор субсидирования»; false — от цены в договоре
    loanFromBase: false,
    defaultPrice: 10000000
  }, window.SM_CALC_CONFIG || {});

  var D = C.buildData(window.SM_DATA);
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    project: $('sm-project'), flat: $('sm-flat'), price: $('sm-price'), disc: $('sm-disc'), type: $('sm-type'),
    kidsField: $('sm-kids-field'), kids: $('sm-kids'), pv: $('sm-pv'), term: $('sm-term'),
    detail: $('sm-detail'), title: $('sm-table-title'), tip: $('sm-tip'), thead: $('sm-thead'), tbody: $('sm-tbody'),
    updated: $('sm-updated')
  };
  var state = { project: D.projects[0], type: D.types[0], pick: null };
  var last = null; // последний расчёт — из него собирается PDF

  function readInputs() {
    var term = parseFloat(String(el.term.value).replace(',', '.'));
    return {
      project: state.project, type: state.type, kids: el.kids.value,
      base: U.parseMoney(el.price.value) || 0, disc: U.parsePct(el.disc.value), pv: U.parseMoney(el.pv.value),
      term: isFinite(term) && term > 0 ? term : null, pick: state.pick
    };
  }

  function hasKids() { return !el.kidsField.hidden; }
  function setupKids() {
    var opts = C.kidsOptions(D, state.project, state.type), cur = el.kids.value;
    el.kidsField.hidden = !opts.length;
    el.kids.innerHTML = opts.map(function (k) { return '<option' + (k === cur ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('');
  }

  /* ---------- Расчёт выбранной программы ---------- */
  function detailHtml(inp, r) {
    var grace = r.graceMonths > 0, rows = [];
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
    var flat = el.flat.value.trim();
    return '<div class="sm-hero">' +
        '<div class="sm-hero-name">' + esc(inp.type + ', ' + r.name) + '</div>' +
        '<div class="sm-hero-flat">' + esc(inp.project) + (hasKids() ? ' · ' + esc(inp.kids) : '') + (flat ? ' · кв. ' + esc(flat) : '') + '</div>' +
        '<div class="sm-pay">' +
          '<div><div class="sm-k">' + (grace ? 'Платёж первые ' + F.period(r.graceMonths) : 'Ежемесячный платёж') + '</div><div class="sm-v">' + F.rub(r.pay1) + '</div></div>' +
          (grace ? '<div><div class="sm-k">Платёж после</div><div class="sm-v sm-v2">' + F.rub(r.pay2) + '</div></div>' : '') +
        '</div></div>' +
      '<dl>' + rows.join('') + '</dl>' +
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
    return '<tr data-id="' + r.id + '" class="' + (r.ok ? 'sm-pick' : 'sm-off') + (r.id === selId ? ' sm-sel' : '') + '"' + (r.ok ? ' tabindex="0"' : '') + '>' +
      COLS.map(function (c) { return '<td data-l="' + c[0] + '"' + cls(c) + '>' + (c[2] && !r.ok ? '—' : '<span>' + c[1](r) + '</span>') + '</td>'; }).join('') + '</tr>';
  }
  function headHtml() { return '<tr>' + COLS.map(function (c) { return '<th' + cls(c) + '>' + c[0] + '</th>'; }).join('') + '</tr>'; }

  function render() {
    var inp = readInputs();
    el.title.textContent = inp.type + (hasKids() ? ', ' + inp.kids : '') + ': все программы';
    if (!inp.base) {
      el.detail.innerHTML = '<p class="sm-empty">Укажите стоимость квартиры.</p>';
      el.thead.innerHTML = el.tbody.innerHTML = el.tip.innerHTML = '';
      last = null;
      return;
    }
    var res = C.mortgage(D, inp, { loanFromBase: CONFIG.loanFromBase });
    if (state.pick != null && !res.picked) state.pick = null; // выбранная вручную перестала подходить — снова автоподбор
    last = { inp: inp, res: res };
    el.detail.innerHTML = res.best ? detailHtml(inp, res.best)
      : '<p class="sm-empty">' + (res.rows.length ? 'При таких условиях ни одна программа не подходит. Измените скидку, взнос или тип ипотеки.' : 'Для этой очереди программ нет.') + '</p>';
    el.thead.innerHTML = res.rows.length ? headHtml() : '';
    el.tbody.innerHTML = res.rows.map(function (r) { return rowHtml(r, res.best && res.best.id); }).join('');
    el.tip.innerHTML = !res.best ? ''
      : state.pick != null ? 'Программа выбрана вручную · <button type="button" class="sm-link" id="sm-auto">вернуть автоподбор</button>'
      : 'Показана программа с наименьшим платежом. Нажмите на строку, чтобы посмотреть другую';
  }

  /* ---------- PDF: лист 1 — условия и расчёт, дальше — таблица программ по 12 строк ---------- */
  function buildReport(png) {
    var inp = last.inp, res = last.res, flat = el.flat.value.trim(), facts = [];
    var add = function (k, v, strong) {
      var c = strong ? ' class="sm-strong"' : '';
      facts.push('<dt' + c + '>' + k + '</dt><dd' + c + '>' + v + '</dd>');
    };
    add('Проект', esc(inp.project));
    if (flat) add('Номер квартиры', esc(flat));
    add('Стоимость квартиры по прайсу', F.rub(inp.base), true);
    add('Скидка', F.pct(inp.disc));
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

  /* ---------- Запуск ---------- */
  var asItems = function (list) { return list.map(function (x) { return { value: x, label: x }; }); };
  U.pills(el.project, asItems(D.projects), state.project, 'v');
  // На кнопках — без слова «ипотека»: оно уже есть в подписи поля
  U.pills(el.type, D.types.map(function (t) { return { value: t, label: t.replace(/[\s-]ипотека$/i, '') }; }), state.type, 'v');
  el.price.value = F.int(CONFIG.defaultPrice);
  el.disc.value = String(+(D.defaultDiscount * 100).toFixed(2)).replace('.', ',');
  el.updated.textContent = window.SM_DATA.updated;
  setupKids();

  var pickPill = function (box, key) {
    U.onPill(box, 'v', function (v, btn) {
      state[key] = v; state.pick = null;
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
  [el.term, el.flat].forEach(function (i) { i.addEventListener('input', render); });
  el.kids.addEventListener('change', render);

  var pick = function (e) {
    var tr = e.target.closest('tr.sm-pick');
    if (tr) { state.pick = +tr.getAttribute('data-id'); render(); }
  };
  el.tbody.addEventListener('click', pick);
  el.tbody.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
  el.tip.addEventListener('click', function (e) { if (e.target.id === 'sm-auto') { state.pick = null; render(); } });
  $('sm-print').addEventListener('click', function () { window.print(); });
  U.saveButton($('sm-save'), $('sm-msg'), createPdf);

  window.SMIpoteka = { createPdf: createPdf, data: D };
  render();
})();
