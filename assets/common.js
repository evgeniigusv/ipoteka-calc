/* Общее для двух калькуляторов: поля ввода и сохранение расчёта в PDF. */
(function () {
  'use strict';
  var F = window.SMCalc.fmt;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* ---------- Поля ---------- */
  function parseMoney(s) { var d = String(s).replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : null; }
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
      if (b) handler(b.getAttribute('data-' + attr), b);
    });
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
  var libs = null, logo = null;

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
      scale: 2, backgroundColor: '#ECE8EF', logging: false, width: size[0], height: h,
      windowWidth: size[0] + 200, windowHeight: h + 200
    }).then(function (c) { done(); return c; }, function (e) { done(); throw e; });
  }
  // build(logoPng) → { pages: [узлы], file: 'имя.pdf' }
  function makePdf(build, orientation) {
    var size = SIZES[orientation];
    return Promise.all([loadLibs(), logoPng(), document.fonts ? document.fonts.ready : null]).then(function (r) {
      var rep = build(r[1]), canvases = [];
      return rep.pages.reduce(function (p, node) {
        return p.then(function () { return draw(node, size); }).then(function (c) { canvases.push(c); });
      }, Promise.resolve()).then(function () {
        var pdf = new window.jspdf.jsPDF({ orientation: orientation, unit: 'mm', format: 'a4' });
        canvases.forEach(function (c, i) {
          if (i) pdf.addPage();
          pdf.setFillColor(236, 232, 239); pdf.rect(0, 0, size[2], size[3], 'F');
          var k = Math.min(size[2] / c.width, size[3] / c.height), w = c.width * k;
          pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', (size[2] - w) / 2, 0, w, c.height * k);
        });
        return { pdf: pdf, file: rep.file.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf', canvases: canvases };
      });
    });
  }
  function saveButton(btn, msg, make) {
    btn.addEventListener('click', function () {
      var label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Готовлю PDF…'; msg.textContent = '';
      make().then(function (r) { if (r) r.pdf.save(r.file); }).catch(function () {
        msg.textContent = 'Не получилось сохранить PDF. Нажмите «Распечатать» и выберите «Сохранить как PDF».';
      }).then(function () { btn.disabled = false; btn.textContent = label; });
    });
  }

  window.SMUi = {
    esc: esc, parseMoney: parseMoney, moneyInput: moneyInput, parsePct: parsePct, pctInput: pctInput,
    pills: pills, onPill: onPill, stamp: stamp, reportHead: reportHead, page: page, makePdf: makePdf, saveButton: saveButton
  };
})();
