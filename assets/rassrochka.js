/* Калькулятор рассрочки: страница. Расчёт — в engine.js, данные — в data.js. */
(function () {
  'use strict';
  var C = window.SMCalc, U = window.SMUi, F = C.fmt, esc = U.esc;

  var CONFIG = Object.assign({ defaultPrice: 10000000 }, window.SM_CALC_CONFIG || {});
  var D = C.buildData(window.SM_DATA);
  var $ = function (id) { return document.getElementById(id); };
  var el = { project: $('sm-project'), flat: $('sm-flat'), price: $('sm-price'), rooms: $('sm-rooms'), extra: $('sm-extra'), cards: $('sm-cards') };
  // pv и step — выбор взноса и периодичности по каждой программе
  var state = { project: D.projects[0], pv: {}, step: {} };

  function readInputs() {
    return {
      project: state.project, base: U.parseMoney(el.price.value) || 0, rooms: +el.rooms.value,
      extra: U.parsePct(el.extra.value), pv: state.pv, step: state.step
    };
  }

  function discLabel(c) {
    if (!c.disc && !c.extra) return 'без скидки';
    if (!c.extra) return 'скидка ' + F.pct1(c.disc);
    if (!c.disc) return 'доп. скидка ' + F.pct1(c.extra);
    return 'скидка ' + F.pct1(c.disc) + ' + ' + F.pct1(c.extra);
  }
  function choice(label, attr, items, current) {
    return '<div class="sm-choice"><span class="sm-label">' + label + '</span><div class="sm-pills sm-sm" data-' + attr + '>' +
      items.map(function (it) {
        return '<button type="button" data-v="' + it.value + '" aria-pressed="' + (it.value === current) + '">' + esc(it.label) + '</button>';
      }).join('') + '</div></div>';
  }

  // forPdf — карточка для отчёта: вместо кнопок выбора выбранный вариант указан текстом
  function cardHtml(c, forPdf) {
    var html = '<section class="sm-card" data-id="' + c.id + '">' +
      '<div class="sm-cardhead"><h2>' + esc(c.name) + '</h2><span class="sm-badge' + (c.disc || c.extra ? '' : ' sm-zero') + '">' + discLabel(c) + '</span></div>' +
      '<p class="sm-desc">' + esc(c.note) + '</p>';
    if (!forPdf && c.pvOptions) html += choice('Первый взнос', 'pv', c.pvOptions.map(function (o) {
      return { value: o.share, label: F.pct1(o.share) + ' · скидка ' + F.pct1(o.disc) };
    }), c.share);
    if (!forPdf && c.steps) html += choice('Платежи', 'step', c.steps.map(function (s) { return { value: s.step, label: s.name }; }), c.step);
    html += '<div class="sm-total"><div><div class="sm-k">Стоимость квартиры</div><div class="sm-v">' + F.rub(c.total) + '</div></div>' +
      (c.saved > 0.5 ? '<div><div class="sm-k">Скидка</div><div class="sm-v sm-v2">' + F.rub(c.saved) + '</div></div>' : '') + '</div>';
    html += '<table><thead><tr><th>Когда</th><th>Платёж</th><th>Сумма</th></tr></thead><tbody>' +
      c.rows.map(function (r) {
        return '<tr><td>' + esc(r.when) + '</td><td>' + esc(r.label) + '<span class="sm-sub">' + esc(r.sub) + '</span></td><td>' + F.rub(r.amount) + '</td></tr>';
      }).join('') + '</tbody></table>';
    html += '<div class="sm-term"><span>Срок рассрочки</span><b>' + F.months(c.termMonths) + ' · до ' + F.dmy(c.end) + '</b></div>';
    return html + '</section>';
  }

  function render() {
    var inp = readInputs();
    if (!inp.base) { el.cards.innerHTML = '<section class="sm-card"><p class="sm-empty">Укажите стоимость квартиры.</p></section>'; return; }
    var cards = C.installments(D, inp);
    el.cards.innerHTML = cards.length ? cards.map(function (c) { return cardHtml(c); }).join('')
      : '<section class="sm-card"><p class="sm-empty">Для этой очереди рассрочек нет.</p></section>';
  }

  /* ---------- PDF: один лист A4 ---------- */
  function buildReport(png) {
    var inp = readInputs(), flat = el.flat.value.trim(), cards = C.installments(D, inp);
    var fact = function (k, v) { return '<div>' + k + '<b>' + v + '</b></div>'; };
    var page = U.page(U.reportHead('Расчёт рассрочки', inp.project + (flat ? ' · кв. ' + flat : '') + ' · ' + U.stamp(), png) +
      '<section class="sm-card"><div class="sm-facts">' + fact('Проект', esc(inp.project)) + (flat ? fact('Номер квартиры', esc(flat)) : '') +
        fact('Стоимость по прайсу', F.rub(inp.base)) + fact('Квартира', esc(el.rooms.options[el.rooms.selectedIndex].text)) +
        (inp.extra ? fact('Доп. скидка', F.pct1(inp.extra)) : '') + '</div></section>' +
      // одна-две рассрочки — во всю ширину листа, больше — в две колонки
      '<div class="sm-cards' + (cards.length <= 2 ? ' sm-one' : '') + '">' + cards.map(function (c) { return cardHtml(c, true); }).join('') + '</div>' +
      '<p class="sm-legal">' + esc($('sm-legal').textContent) + '</p>', 'portrait');
    return { pages: [page], file: 'Расчёт рассрочки ' + inp.project + (flat ? ' кв ' + flat : '') + ' ' + new Date().toLocaleDateString('ru-RU') };
  }
  function createPdf() { return readInputs().base ? U.makePdf(buildReport, 'portrait') : Promise.resolve(null); }

  /* ---------- Запуск ---------- */
  U.pills(el.project, D.projects.map(function (p) { return { value: p, label: p }; }), state.project, 'v');
  el.price.value = F.int(CONFIG.defaultPrice);
  $('sm-updated').textContent = window.SM_DATA.updated;

  U.onPill(el.project, 'v', function (v, btn) {
    state.project = v;
    Array.prototype.forEach.call(el.project.children, function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
    render();
  });
  el.cards.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'), card = e.target.closest('[data-id]');
    if (!b || !card) return;
    var key = b.parentNode.hasAttribute('data-pv') ? 'pv' : 'step';
    state[key][card.getAttribute('data-id')] = +b.getAttribute('data-v');
    render();
  });
  U.moneyInput(el.price, render);
  U.pctInput(el.extra, render);
  el.rooms.addEventListener('change', render);
  $('sm-print').addEventListener('click', function () { window.print(); });
  U.saveButton($('sm-save'), $('sm-msg'), createPdf);

  window.SMRassrochka = { createPdf: createPdf, data: D };
  render();
})();
