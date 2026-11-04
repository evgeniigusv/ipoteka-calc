/* Выбор квартиры из отдельной выгрузки Macro. Без подключения к Macro из браузера. */
(function (root) {
  'use strict';
  var houses = { 'ДА — 1 очередь': [6736582, 10899161], 'ДА — 2 очередь': [6871059], 'ДНК — 2 очередь': [11013930] };
  function setup(options) {
    var list = [], project = options.project, updated = '', loaded = false;
    var select = options.select, info = options.info;
    function refresh() {
      select.replaceChildren(new Option('Ввести цену вручную', ''));
      list.forEach(function (row, i) {
        if ((houses[project] || []).indexOf(row.house_id) < 0) return;
        var title = '№ ' + row.num + (row.house_id === 10899161 ? ' · ПИФ' : '') +
          ' · этаж ' + (row.floor || '—') + ' · ' + Number(row.area).toLocaleString('ru-RU') + ' м²';
        select.add(new Option(title, String(i + 1)));
      });
      info.textContent = loaded ? 'Обновление Macro: ' + updated + ' (время сервера). Данные обновляются автоматически; наличие и цену уточняйте в Macro.' : 'Список квартир недоступен. Можно ввести цену вручную.';
    }
    function current() { var i = Number(select.value); return i > 0 ? list[i - 1] : null; }
    select.addEventListener('change', function () {
      var row = current();
      if (row) {
        options.price.value = Number(row.price).toLocaleString('ru-RU');
        if (options.rooms) options.rooms.value = String(row.studio || Number(row.rooms) <= 1 ? 1 : Math.min(3, Number(row.rooms)));
        if (options.discount) {
          var price = Number(row.price), action = Number(row.action);
          options.discount.value = action > 0 && action < price ? ((price - action) / price * 100).toFixed(2).replace('.', ',') : '0';
        }
      }
      options.onChange();
    });
    fetch('assets/macro-flats.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no data'); return r.json();
    }).then(function (data) {
      if (!Array.isArray(data.rows) || !data.updated) throw new Error('invalid data');
      list = data.rows; updated = data.updated; loaded = true; refresh();
    }).catch(refresh);
    return {
      setProject: function (next) { project = next; options.price.value = ''; refresh(); },
      isPif: function () { var row = current(); return !!row && row.house_id === 10899161; },
      selectedNumber: function () { var row = current(); return row ? String(row.num) + (row.house_id === 10899161 ? ' (ПИФ)' : '') : ''; }
    };
  }
  root.SMFlats = { setup: setup };
})(window);
