/* Выбор квартиры из отдельной выгрузки Macro. Без подключения к Macro из браузера. */
(function (root) {
  'use strict';
  var houses = { 'ДА — 1 очередь': [6736582], 'ДА — 2 очередь': [6871059], 'ДНК — 2 очередь': [11013930] };
  function setup(options) {
    var selectedCash = null, selectedPrice = '', selectedDiscount = '';
    var list = [], project = options.project, updated = '', loaded = false, failed = false;
    var select = options.select, search = document.getElementById('sm-flat-search'), info = options.info;
    function normalize(value) { return String(value || '').trim().replace(/^(?:кв\.?\s*)?№?\s*/i, '').toLowerCase(); }
    function current() { var i = Number(select.value); return i > 0 ? list[i - 1] : null; }
    function matches() {
      var query = normalize(search.value);
      return list.map(function (row, i) { return { row: row, index: i }; }).filter(function (item) {
        return (houses[project] || []).indexOf(item.row.house_id) >= 0 && (!query || normalize(item.row.num).indexOf(query) >= 0);
      });
    }
    function hint(found, exact) {
      if (failed) return 'Список квартир недоступен. Укажите номер и цену вручную.';
      if (!loaded) return 'Загрузка квартир из Macro…';
      var message = 'Обновление Macro: ' + updated + ' (время сервера). Наличие и цену уточняйте в Macro.';
      if (normalize(search.value) && !found.length) return 'Квартира не найдена в остатке Macro. Цену можно ввести вручную. ' + message;
      if (exact > 1) return 'Найдено несколько квартир с таким номером. Выберите нужную из списка. ' + message;
      return message;
    }
    function refresh() {
      var found = matches(), query = normalize(search.value), exact = found.filter(function (it) { return normalize(it.row.num) === query; });
      select.replaceChildren(new Option(query ? 'Выберите квартиру или введите цену' : 'Выбрать из списка', ''));
      found.forEach(function (item) {
        var row = item.row;
        var title = '№ ' + row.num + (row.house_id === 10899161 ? ' · ПИФ' : '') +
          ' · этаж ' + (row.floor || '—') + ' · ' + Number(row.area).toLocaleString('ru-RU') + ' м²';
        select.add(new Option(title, String(item.index + 1)));
      });
      info.textContent = hint(found, exact.length);
      return exact;
    }
    function apply(row) {
      selectedCash=null;
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
    select.addEventListener('change', function () {
      var row = current();
      if (row) { search.value = String(row.num); apply(row); }
      else { options.price.value = ''; if (options.onClear) options.onClear(); if (options.discount) options.discount.value = ''; }
      options.onChange();
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
      setProject: function (next) { project = next; selectedCash=null; search.value = ''; options.price.value = ''; if(options.discount) options.discount.value=''; if(options.onClear) options.onClear(); refresh(); },
      cashPrice: function(){return current() && options.discount && options.price.value===selectedPrice && options.discount.value===selectedDiscount ? selectedCash : null;},
      isPif: function () { var row = current(); return !!row && row.house_id === 10899161; },
      selectedNumber: function () { var row = current(); return row ? String(row.num) + (row.house_id === 10899161 ? ' (ПИФ)' : '') : search.value.trim(); }
    };
  }
  root.SMFlats = { setup: setup };
})(window);
