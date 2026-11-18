/* Общее для двух калькуляторов: поля ввода и сохранение расчёта в PDF. */
(function () {
  'use strict';
  var F = window.SMCalc.fmt;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* ---------- Поля ---------- */
  function parseMoney(s) { var d=String(s).trim().replace(/(?:₽|руб\.?|р\.)$/i,'').replace(/\s/g,'').replace(',','.'); if(!/^\d+(?:\.\d{1,2})?$/.test(d))return null; var n=Number(d);return Number.isSafeInteger(Math.round(n))?Math.round(n):null; }
  // Сумма с пробелами между разрядами; курсор остаётся на месте
  function moneyInput(input, onChange) {
    input.addEventListener('input', function () {
      var v = parseMoney(input.value), fromEnd = input.value.length - input.selectionStart;
      input.value = v == null ? '' : F.int(v);
      try { var p = Math.max(0, input.value.length - fromEnd); input.setSelectionRange(p, p); } catch (e) {}
      onChange();
    });
  }
  // Проценты: «13», «7,5», «7.5» — запятая, до двух знаков, не больше 100
  function parsePct(s) {
    var v = parseFloat(String(s).replace(',', '.'));
    return isFinite(v) ? Math.min(Math.max(v, 0), 100) / 100 : 0;
  }
  function pctInput(input, onChange) {
    input.addEventListener('input', function () {
      var t = input.value.replace(/\./g, ',').replace(/[^\d,]/g, ''), i = t.indexOf(',');
      if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, '').slice(0, 2);
      if (i === 0) t = '0' + t;
      if (parseFloat(t.replace(',', '.')) > 100) t = '100';
      if (t !== input.value) input.value = t;
      onChange();
    });
  }
  function pills(box, items, current, attr) {
    box.innerHTML = items.map(function (it) {
      return '<button type="button" data-' + attr + '="' + esc(it.value) + '" aria-pressed="' + (it.value === current) + '">' + esc(it.label) + '</button>';
    }).join('');
  }
  function onPill(box, attr, handler) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-' + attr + ']');
      if (!b || b.getAttribute('aria-pressed') === 'true') return;
      handler(b.getAttribute('data-' + attr), b);
      programFeedback(e);
    });
  }
  function playCue(node, name) {
    if (!node) return;
    const repeating = node.classList.contains(name);
    node.classList.add(name);
    const effect = node.getAnimations().find(animation => animation.animationName === name);
    if (!effect) { node.classList.remove(name); return; }
    if (repeating) { effect.currentTime = 0; return; }
    const clear = () => node.classList.remove(name);
    effect.finished.then(clear, clear);
  }

  let issued = false;
  function resultIssued(container) {
    if (issued) return;
    const hero = container.querySelector('.sm-hero');
    if (!hero) return;
    issued = true;
    if (document.documentElement.dataset.smInput !== 'keyboard' &&
        matchMedia('screen and (prefers-reduced-motion: no-preference)').matches) {
      playCue(hero, 'sm-result-issued');
    }
  }

  function programFeedback(event, row, repeat = false) {
    if (document.documentElement.dataset.smInput !== 'pointer' ||
        (event.type === 'click' && event.detail === 0) ||
        !matchMedia('screen and (prefers-reduced-motion: no-preference)').matches) return;
    const card = document.querySelector('#calc-result .sm-hero, #calc-result .sm-empty');
    if (!card) return;
    card.classList.remove('sm-result-issued');
    if (repeat) card.classList.remove('sm-program-enter');
    playCue(card, repeat ? 'sm-result-confirm' : 'sm-program-enter');
    if (row) playCue(row.querySelector('td:first-child > span'), 'sm-program-choice');
  }

  if (typeof document !== 'undefined' && document.getElementById('calc-result')) {
    for (const link of document.querySelectorAll('a[href="#calc-result"]')) {
      link.addEventListener('click', event => programFeedback(event, null, true));
    }
  }

  function onProgramSelect(select, apply) {
    let previousOption;
    select.addEventListener('pointerdown', event => {
      previousOption = event.target.closest('option:checked');
    });
    select.addEventListener('change', event => {
      apply();
      programFeedback(event);
    });
    // Повторный выбор в нативном меню не вызывает change.
    select.addEventListener('click', event => {
      if (event.target === previousOption) programFeedback(event, null, true);
      previousOption = null;
    });
  }

  function emptyResult(container, message, field, label) {
    const note = document.createElement('p');
    note.className = 'sm-empty';
    note.textContent = message;
    if (field && !field.value.trim() && !field.disabled && !field.readOnly) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sm-link sm-result-action';
      button.textContent = label;
      button.addEventListener('click', () => field.focus());
      note.append(' ', button);
    }
    container.replaceChildren(note);
  }
  function markProgram(row) {
    const previous = row.parentElement.querySelector('.sm-sel');
    if (previous === row) return;
    if (previous) {
      previous.classList.remove('sm-sel');
      previous.removeAttribute('aria-current');
      previous.querySelector('button')?.setAttribute('aria-pressed', 'false');
    }
    row.classList.add('sm-sel');
    row.setAttribute('aria-current', 'true');
    row.querySelector('button')?.setAttribute('aria-pressed', 'true');
  }
  function stamp() {
    var now = new Date();
    return now.toLocaleDateString('ru-RU') + ', ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- PDF ----------
     Отчёт собирается отдельно от экрана: каждый лист рисуется html2canvas и кладётся на страницу A4 (jsPDF).
     Библиотеки подгружаются только по нажатию кнопки. От прокрутки и ширины экрана результат не зависит. */
  var PDF_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ];
  var SIZES = { landscape: [1123, 794, 297, 210], portrait: [794, 1123, 210, 297] }; // px при 96 dpi и мм
  var PDF_DISCLAIMER = 'Не является публичной офертой. Окончательные расчёты уточнять у менеджера отдела продаж.';
  var PDF_FOOTER_MM = 18;
  var libs = null, logo = null;

  // Включая ЧПВ и Ctrl+P. Поле @page отделяет колонтитул от расчётов на каждом листе.
  // В браузерах без полей страниц текст остаётся в потоке в конце документа.
  function preparePrint() {
    if (!document.getElementById('sm-print-disclaimer-style')) {
      var marginBoxes = typeof window.CSSMarginRule !== 'undefined';
      var style = document.createElement('style');
      style.id = 'sm-print-disclaimer-style';
      style.textContent = '#sm-print-disclaimer{display:none}' +
        '@media print{@page{margin:12mm 12mm 24mm;' +
        (marginBoxes ? '@bottom-center{content:' + JSON.stringify(PDF_DISCLAIMER) + ';font:9pt/1.35 Arial,sans-serif;color:#2f2f2f;vertical-align:middle;}' : '') + '}' +
        'html body > #sm-print-disclaimer,html body.tools > #sm-print-disclaimer{' +
        'display:' + (marginBoxes ? 'none' : 'block') + '!important;position:static;break-inside:avoid;' +
        'box-sizing:border-box;padding:2mm 0;margin:12mm 0 0;border-top:.2mm solid #aaa;' +
        'background:#fff;color:#2f2f2f;font:9pt/1.35 Arial,sans-serif;text-align:center;' +
        '-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
      document.head.appendChild(style);
    }
    if (!document.getElementById('sm-print-disclaimer')) {
      var footer = document.createElement('div');
      footer.id = 'sm-print-disclaimer'; footer.textContent = PDF_DISCLAIMER;
      document.body.appendChild(footer);
    }
  }
  if (window.addEventListener) {
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', function () {
      var footer = document.getElementById('sm-print-disclaimer');
      if (footer) footer.remove();
    });
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res;
      s.onerror = function () { rej(new Error('не загрузился ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (window.html2canvas && window.jspdf) return Promise.resolve();
    if (!libs) libs = Promise.all(PDF_LIBS.map(loadScript)).catch(function (e) { libs = null; throw e; });
    return libs;
  }
  // html2canvas плохо рисует SVG, поэтому логотип для отчёта переводим в PNG
  function logoPng() {
    if (logo != null) return Promise.resolve(logo);
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = 609; cv.height = 321;
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          logo = cv.toDataURL('image/png');
        } catch (e) { logo = ''; }
        res(logo);
      };
      img.onerror = function () { res(logo = ''); };
      img.src = 'assets/logo-svoboda-dark.svg';
    });
  }
  function reportHead(title, meta, png) {
    return '<div class="sm-head"><div><h1>' + esc(title) + '</h1><div class="sm-meta">' + esc(meta) + '</div></div>' +
      (png ? '<span class="sm-logo"><img src="' + png + '" alt="Свобода мысли"></span>' : '') + '</div>';
  }
  function page(html, orientation) {
    var d = document.createElement('div');
    d.className = 'sm sm-pdf ' + (orientation === 'portrait' ? 'sm-port' : 'sm-land');
    d.innerHTML = html;
    // внутренние цифры (комиссия банку, профицит) в отчёт для клиента не идут
    Array.prototype.forEach.call(d.querySelectorAll('.sm-int'), function (e) { e.remove(); });
    return d;
  }
  function draw(node, size) {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;width:' + size[0] + 'px;';
    host.appendChild(node);
    document.body.appendChild(host);
    var h = Math.max(size[1], node.offsetHeight);
    var done = function () { host.remove(); };
    return window.html2canvas(node, {
      scrollX: 0, scrollY: 0, scale: 2, backgroundColor: node.classList.contains('tools-pdf') ? '#FFFFFF' : '#ECE8EF', logging: false, width: size[0], height: h,
      windowWidth: size[0] + 200, windowHeight: h + 200
    }).then(function (c) { done(); return c; }, function (e) { done(); throw e; });
  }
  // build(logoPng) → { pages: [узлы], file: 'имя.pdf' }
  function drawDisclaimer(size) {
    // Отдельный растр сохраняет кириллицу без зависимости от встроенных шрифтов jsPDF.
    var footer = document.createElement('div');
    footer.className = 'sm-pdf-disclaimer';
    footer.textContent = PDF_DISCLAIMER;
    footer.style.cssText = 'box-sizing:border-box;width:' + size[0] + 'px;min-height:52px;padding:10px 30px;background:#fff;color:#2f2f2f;font:14px/1.4 Onest,Arial,sans-serif;text-align:center;';
    return draw(footer, [size[0], 52]);
  }
  function makePdf(build, orientation) {
    var size = SIZES[orientation];
    return Promise.all([loadLibs(), logoPng(), document.fonts ? document.fonts.ready : null]).then(function (r) {
      var rep = build(r[1]), canvases = [];
      return rep.pages.reduce(function (p, node) {
        return p.then(function () { return draw(node, size); }).then(function (c) { canvases.push(c); });
      }, Promise.resolve()).then(function () { return drawDisclaimer(size); }).then(function (footer) {
        var pdf = new window.jspdf.jsPDF({ orientation: orientation, unit: 'mm', format: 'a4' });
        canvases.forEach(function (c, i) {
          if (i) pdf.addPage();
          pdf.setFillColor(236, 232, 239); pdf.rect(0, 0, size[2], size[3], 'F');
          // Расчёты целиком помещаются над зарезервированной нижней полосой.
          var k = Math.min(size[2] / c.width, (size[3] - PDF_FOOTER_MM) / c.height), w = c.width * k;
          pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', (size[2] - w) / 2, 0, w, c.height * k);
          pdf.setFillColor(255, 255, 255); pdf.rect(0, size[3] - PDF_FOOTER_MM, size[2], PDF_FOOTER_MM, 'F');
          var footerScale = Math.min(size[2] / footer.width, (PDF_FOOTER_MM - 4) / footer.height);
          var footerWidth = footer.width * footerScale, footerHeight = footer.height * footerScale;
          pdf.addImage(footer.toDataURL('image/png'), 'PNG', (size[2] - footerWidth) / 2, size[3] - PDF_FOOTER_MM + 2, footerWidth, footerHeight);
        });
        return { pdf: pdf, file: rep.file.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf', canvases: canvases };
      });
    });
  }
  function saveButton(btn, msg, make) {
    btn.addEventListener('click', async function () {
      if (btn.getAttribute('aria-busy') === 'true') return;
      const label = btn.textContent;
      btn.setAttribute('aria-busy', 'true');
      // Форма управляет disabled при пересчёте. Блокировка экспорта сохраняет фокус.
      btn.setAttribute('aria-disabled', 'true');
      btn.textContent = 'Готовлю PDF…'; msg.textContent = '';
      try {
        const result = await make();
        if (result) await result.pdf.save(result.file);
      } catch {
        msg.textContent = 'Не получилось сохранить PDF. Нажмите «Распечатать» и выберите «Сохранить как PDF».';
      } finally {
        btn.removeAttribute('aria-busy');
        btn.removeAttribute('aria-disabled');
        btn.textContent = label;
      }
    });
  }

  window.SMUi = {
    esc: esc, parseMoney: parseMoney, moneyInput: moneyInput, parsePct: parsePct, pctInput: pctInput,
    pills: pills, onPill: onPill, programFeedback: programFeedback, resultIssued: resultIssued, onProgramSelect: onProgramSelect, emptyResult: emptyResult, markProgram: markProgram, stamp: stamp, reportHead: reportHead, page: page, makePdf: makePdf, saveButton: saveButton
  };
})();
