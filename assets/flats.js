/* Выбор квартиры из отдельной выгрузки Macro. Без подключения к Macro из браузера. */
(function (root) {
  'use strict';
  var houses = { 'ДА — 1 очередь': [6736582], 'ДА — 2 очередь': [6871059], 'ДНК — 2 очередь': [11013930] };
  function setup(options) {
    var selectedCash = null, selectedPrice = '', selectedDiscount = '';
    var projectState = Object.create(null);
    var list = [], project = options.project, updated = '', loaded = false, failed = false;
    var select = options.select, search = document.getElementById('sm-flat-search'), info = options.info;
    var hasManualPrice = false, manualAfterQuery = false;
    options.price.addEventListener('input', function () {
      hasManualPrice = true;
      manualAfterQuery = true;
    });
    var warning = document.createElement('div');
    warning.className = 'sm-special-flat-warning';
    warning.setAttribute('role', 'alert');
    warning.setAttribute('aria-atomic', 'true');
    warning.hidden = true;
    // Общий компонент всех калькуляторов; оформление не зависит от CSS редактора.
    warning.style.cssText = 'margin:16px 0;padding:18px;border:2px solid var(--indian-text,#A63F3F);border-radius:var(--r-md,16px);background:var(--white,#fff);color:var(--indian-text,#A63F3F);font-size:clamp(18px,2vw,22px);font-weight:600;line-height:1.45;';
    var warningTitle = document.createElement('strong'), warningText = document.createElement('p');
    warningTitle.textContent = 'ВНИМАНИЕ!';
    warningText.textContent = 'Квартира доступна к покупке только при 100% оплате или по любой ипотечной программе без субсидирования.';
    warningText.style.margin = '8px 0 0';
    warning.append(warningTitle, warningText);
    info.after(warning);
    function updateWarning(row) {
      if (arguments.length === 0) row = current();
      var settings = (root.SM_TOOLS_DATA && root.SM_TOOLS_DATA.settings) || (root.SM_DATA && root.SM_DATA.settings) || {};
      warning.hidden = !row || !Array.isArray(settings.specialFlats) || settings.specialFlats.indexOf(String(row.house_id) + ':' + String(row.num)) < 0;
    }
    // Загрузка метаданных может закончиться уже после выбора квартиры.
    Promise.resolve(root.SM_TOOLS_READY).then(function () { updateWarning(); }, function () { updateWarning(); });
    root.addEventListener('sm-settings-changed', function () { updateWarning(); });
    function normalize(value) { return String(value || '').trim().replace(/^(?:кв\.?\s*)?№?\s*/i, '').toLowerCase(); }
    function current() { var i = Number(select.value); return i > 0 ? list[i - 1] : null; }
    function matches() {
      var query = normalize(search.value);
      return list.map(function (row, i) { return { row: row, index: i }; }).filter(function (item) {
        return (houses[project] || []).indexOf(item.row.house_id) >= 0 && (!query || normalize(item.row.num).indexOf(query) >= 0);
      });
    }
    function hint(issue) {
      if (issue) return issue;
      if (!loaded) return 'Загрузка квартир из Macro…';
      return 'Обновление Macro: ' + updated + ' (время сервера). Наличие и цену уточняйте в Macro.';
    }
    function title(row) {
      return '№ ' + row.num + (row.house_id === 10899161 ? ' · ПИФ' : '') +
        ' · этаж ' + (row.floor || '—') + ' · ' + Number(row.area).toLocaleString('ru-RU') + ' м²' + (row.status ? ' · ' + row.status : '');
    }
    var combo = root.SMFlatSearch?.setup(search, {
      choices: () => matches().map(item => ({value: String(item.index + 1), label: title(item.row)})),
      emptyMessage: () => failed ? 'Список недоступен. Цену можно ввести вручную.'
        : !loaded ? 'Загрузка квартир из Macro…' : 'Совпадений нет. Цену можно ввести вручную.',
      choose: value => {
        select.value = value;
        select.dispatchEvent(new Event('change', {bubbles: true}));
      }
    });
    function refresh() {
      var found = matches(), query = normalize(search.value), exact = found.filter(function (it) { return normalize(it.row.num) === query; });
      select.replaceChildren(new Option(query ? 'Выберите квартиру или введите цену' : 'Выбрать из списка', ''));
      found.forEach(function (item) {
        select.add(new Option(title(item.row), String(item.index + 1)));
      });
      combo?.refresh();
      let issue = '';
      if (failed) issue = 'Список квартир недоступен. Укажите номер и цену вручную.';
      else if (loaded && query && !found.length) issue = 'Квартира не найдена в остатке Macro. Цену можно ввести вручную.';
      else if (exact.length > 1) issue = 'Найдено несколько квартир с таким номером. Выберите нужную из списка.';
      info.setAttribute('data-action-needed', String(Boolean(issue)));
      info.textContent = hint(issue);
      updateWarning();
      return exact;
    }
    function apply(row) {
      selectedCash=null;
      updateWarning(row);
      if (options.onClear) options.onClear();
      if (row) {
        hasManualPrice = false; manualAfterQuery = false;
        options.price.value = Number(row.price).toLocaleString('ru-RU');
        if (options.rooms) options.rooms.value = String(row.studio || Number(row.rooms) <= 1 ? 1 : Math.min(3, Number(row.rooms)));
        if (options.onSelect) options.onSelect(row);
        if (options.discount) {
          var price = Number(row.price), action = Number(row.action);
          options.discount.value = action > 0 && action <= price ? ((price - action) / price * 100).toFixed(2).replace('.', ',') : '';
          if(action>0 && action<=price){selectedCash=action;selectedPrice=options.price.value;selectedDiscount=options.discount.value;}
        }
      }
    }
    function setProject(next) {
      if (next === project) return;
      combo?.close(true);
      var carryPrice = !current() && !search.value.trim();
      var previousPrice = carryPrice ? options.price.value : '';
      projectState[project] = {
        hasManualPrice, manualAfterQuery, pending: !loaded,
        query: search.value, selection: select.value, price: options.price.value,
        rooms: options.rooms ? options.rooms.value : '',
        discount: options.discount ? options.discount.value : '',
        cash: selectedCash, sourcePrice: selectedPrice, sourceDiscount: selectedDiscount
      };
      var saved = projectState[next];
      project = next;
      selectedCash = null; selectedPrice = ''; selectedDiscount = '';
      hasManualPrice = carryPrice && hasManualPrice; manualAfterQuery = false;
      search.value = saved ? saved.query : '';
      options.price.value = saved ? saved.price : previousPrice;
      if (options.discount) options.discount.value = '';
      if (options.onClear) options.onClear();
      var exact = refresh();
      if (saved) {
        var restored = saved.selection ? list[Number(saved.selection) - 1] : null;
        if (restored && (houses[project] || []).indexOf(restored.house_id) >= 0) {
          select.value = saved.selection;
          apply(restored);
        }
        options.price.value = saved.price;
        if (options.rooms) options.rooms.value = saved.rooms;
        if (options.discount) options.discount.value = saved.discount;
        hasManualPrice = saved.hasManualPrice; manualAfterQuery = saved.manualAfterQuery;
        selectedCash = saved.cash; selectedPrice = saved.sourcePrice; selectedDiscount = saved.sourceDiscount;
        if (saved.pending && loaded && !manualAfterQuery) applyExact(exact);
      }
    }
    function applyExact(exact) {
      if (!normalize(search.value) || exact.length !== 1) return false;
      select.value = String(exact[0].index + 1);
      apply(exact[0].row);
      return true;
    }
    function searchChanged() {
      manualAfterQuery = false;
      // Начальная цена калькулятора — пример. Её нельзя выдавать за цену искомой квартиры.
      if (!hasManualPrice) options.price.value = '';
      if (!hasManualPrice || current()) {
        if (options.onClear) options.onClear();
        if (options.discount) options.discount.value = '';
      }
      selectedCash = null;
      var exact = refresh();
      if (loaded) applyExact(exact);
      if (document.activeElement === search) combo?.open();
      options.onChange();
    }
    var composing = false, completedText = null;
    search.addEventListener('compositionstart', function () { composing = true; });
    search.addEventListener('compositionend', function () {
      composing = false;
      completedText = search.value;
      searchChanged();
    });
    search.addEventListener('input', function (event) {
      if (composing || event?.isComposing) return;
      // Некоторые клавиатуры отправляют ещё один input после compositionend.
      if (completedText !== search.value) searchChanged();
      completedText = null;
    });
    select.addEventListener('change', function (event) {
      combo?.close();
      var row = current();
      if (row) {
        search.value = String(row.num);
        info.setAttribute('data-action-needed', 'false');
        info.textContent = hint('');
        apply(row);
      }
      else { if (!hasManualPrice) options.price.value = ''; if (options.onClear) options.onClear(); if (options.discount) options.discount.value = ''; }
      updateWarning(row);
      options.onChange();
      if (row) root.SMUi?.programFeedback(event);
    });
    fetch('assets/macro-flats.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no data'); return r.json();
    }).then(function (data) {
      if (!Array.isArray(data.rows) || !data.updated) throw new Error('invalid data');
      list = data.rows; updated = data.updated; loaded = true;
      var exact = refresh();
      if (!composing && !manualAfterQuery && applyExact(exact)) options.onChange();
    }).catch(function () { failed = true; refresh(); });
    return {
      setProject: setProject,
      cashPrice: function(){return current() && options.discount && options.price.value===selectedPrice && options.discount.value===selectedDiscount ? selectedCash : null;},
      isPif: function () { var row = current(); return !!row && row.house_id === 10899161; },
      selectedNumber: function () { var row = current(); return row ? String(row.num) + (row.house_id === 10899161 ? ' (ПИФ)' : '') : search.value.trim(); }
    };
  }
  root.SMFlats = { setup: setup };
})(window);
