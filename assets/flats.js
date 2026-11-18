/* Выбор квартиры из отдельной выгрузки Macro. Без подключения к Macro из браузера. */
(function (root) {
  'use strict';
  var houses = { 'ДА — 1 очередь': [6736582], 'ДА — 2 очередь': [6871059], 'ДНК — 2 очередь': [11013930] };
  function setup(options) {
    var selectedCash = null, selectedPrice = '', selectedDiscount = '';
    var projectState = Object.create(null);
    var list = [], project = options.project, updated = '', loaded = false, failed = false;
    var select = options.select, search = document.getElementById('sm-flat-search'), info = options.info;
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
    function refresh() {
      var found = matches(), query = normalize(search.value), exact = found.filter(function (it) { return normalize(it.row.num) === query; });
      select.replaceChildren(new Option(query ? 'Выберите квартиру или введите цену' : 'Выбрать из списка', ''));
      found.forEach(function (item) {
        var row = item.row;
        var title = '№ ' + row.num + (row.house_id === 10899161 ? ' · ПИФ' : '') +
          ' · этаж ' + (row.floor || '—') + ' · ' + Number(row.area).toLocaleString('ru-RU') + ' м²' + (row.status ? ' · ' + row.status : '');
        select.add(new Option(title, String(item.index + 1)));
      });
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
      var row = current(), manualPrice = !row && !search.value.trim() ? options.price.value : '';
      projectState[project] = {
        query: search.value, selection: select.value, price: options.price.value,
        rooms: options.rooms ? options.rooms.value : '',
        discount: options.discount ? options.discount.value : '',
        cash: selectedCash, sourcePrice: selectedPrice, sourceDiscount: selectedDiscount
      };
      var saved = projectState[next];
      project = next;
      selectedCash = null; selectedPrice = ''; selectedDiscount = '';
      search.value = saved ? saved.query : '';
      options.price.value = saved ? saved.price : manualPrice;
      if (options.discount) options.discount.value = '';
      if (options.onClear) options.onClear();
      refresh();
      if (saved) {
        var restored = saved.selection ? list[Number(saved.selection) - 1] : null;
        if (restored && (houses[project] || []).indexOf(restored.house_id) >= 0) {
          select.value = saved.selection;
          apply(restored);
        }
        options.price.value = saved.price;
        if (options.rooms) options.rooms.value = saved.rooms;
        if (options.discount) options.discount.value = saved.discount;
        selectedCash = saved.cash; selectedPrice = saved.sourcePrice; selectedDiscount = saved.sourceDiscount;
      }
    }
    search.addEventListener('input', function () {
      options.price.value = '';
      if (options.onClear) options.onClear();
      if (options.discount) options.discount.value = '';
      var exact = refresh();
      if (loaded && normalize(search.value) && exact.length === 1) {
        select.value = String(exact[0].index + 1);
        apply(exact[0].row);
      }
      options.onChange();
    });
    select.addEventListener('change', function (event) {
      var row = current();
      if (row) {
        search.value = String(row.num);
        info.setAttribute('data-action-needed', 'false');
        info.textContent = hint('');
        apply(row);
      }
      else { options.price.value = ''; if (options.onClear) options.onClear(); if (options.discount) options.discount.value = ''; }
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
      if (normalize(search.value) && exact.length === 1) { select.value = String(exact[0].index + 1); apply(exact[0].row); options.onChange(); }
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
