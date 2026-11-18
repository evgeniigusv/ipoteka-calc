/* Настройки: публичный просмотр или редактирование после локальной авторизации.
   API: GET /api/settings → {revision, settings}; POST {revision, settings}
   → {data, published, error}. refresh() можно вызывать из render основного редактора. */
(function (root) {
  'use strict';
  var projects = { da1: 'ДА — 1 очередь', da2: 'ДА — 2 очередь', dnk2: 'ДНК — 2 очередь' };
  var houseProjects = { 6736582: 'da1', 10899161: 'da1', 6871059: 'da2', 11013930: 'dnk2' };
  var instance;
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function defaults(settings) {
    var result = copy(settings || {});
    result.subsidyCompensation = Object.assign({ da1: .1, da2: .1, dnk2: .1 }, result.subsidyCompensation);
    result.specialFlats = Array.from(new Set(result.specialFlats || [])).sort();
    return result;
  }
  function key(row) { return String(row.house_id) + ':' + String(row.num); }
  function normalize(value) { return String(value).trim().replace(/^(?:кв\.?\s*)?№?\s*/i, '').toLowerCase(); }
  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function setup(options) {
    if (instance) return instance;
    var toolbar = document.querySelector('.tools-toolbar');
    if (!toolbar) throw new Error('Не найден раздел инструментов.');
    var initial = options.getData() || {}, revision = initial.revision;
    var baseline = defaults(initial.settings), draft = copy(baseline), dirty = false, busy = false, destroyed = false;
    var rows = [], flatsLoaded = false, flatsBusy = false, settingsReady = false;
    var host = element('details', 'tools-settings');
    host.setAttribute('aria-label', 'Настройки продаж');
    host.append(element('summary', '', 'Настройки продаж'));
    if(options.mount)options.mount.append(host);else toolbar.before(host);
    var saveButtons = [], resetButtons = [], inputs = {};
    var status = element('p', 'tools-settings-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var guard = element('p', 'tools-settings-hint');
    guard.textContent = 'Сначала сохраните или отмените изменения инструментов.';
    var capSection = element('details', 'tools-settings-section');
    capSection.open = true;
    capSection.append(element('summary', '', 'Компенсация ипотечной субсидии'));
    var capBody = element('div', 'tools-settings-body');
    capBody.append(element('p', 'tools-settings-hint', 'Максимальная компенсация субсидии от стоимости квартиры, %. База расчёта — цена при 100% оплате.'));
    var capGrid = element('div', 'tools-settings-caps');
    Object.keys(projects).forEach(function (project) {
      var label = element('label', 'tools-settings-field', projects[project]);
      var input = element('input');
      input.type = 'number'; input.min = '0'; input.max = '99'; input.step = '0.01'; input.required = true;
      input.setAttribute('aria-label', projects[project] + ': максимальная компенсация субсидии, %');
      input.addEventListener('input', function () {
        draft.subsidyCompensation[project] = input.value === '' ? null : Number(input.value) / 100;
        changed();
      });
      inputs[project] = input; label.append(input); capGrid.append(label);
    });
    capBody.append(capGrid); capSection.append(capBody);
    var flatSection = element('details', 'tools-settings-section');
    flatSection.append(element('summary', '', 'Квартиры со специальными условиями'));
    var flatBody = element('div', 'tools-settings-body');
    flatBody.append(element('p', 'tools-settings-hint', 'Отметьте квартиры, доступные только при 100% оплате или по ипотеке без субсидирования. Квартиры останутся во всех калькуляторах.'));
    var filters = element('div', 'tools-settings-filters');
    var projectLabel = element('label', 'tools-settings-field', 'Жилой комплекс');
    var projectSelect = element('select');
    projectSelect.add(new Option('Все проекты', 'all'));
    Object.keys(projects).forEach(function (project) { projectSelect.add(new Option(projects[project], project)); });
    projectLabel.append(projectSelect);
    var searchLabel = element('label', 'tools-settings-field', 'Номер квартиры');
    var search = element('input'); search.type = 'search'; search.placeholder = 'Например, 42';
    searchLabel.append(search); filters.append(projectLabel, searchLabel);
    var flatStatus = element('p', 'tools-settings-hint');
    flatStatus.setAttribute('role', 'status');
    var retry = element('button', 't-btn', 'Повторить загрузку квартир'); retry.type = 'button'; retry.hidden = true;
    var list = element('div', 'tools-settings-flats');
    flatBody.append(filters, flatStatus, retry, list); flatSection.append(flatBody);
    function actionBar() {
      var bar = element('div', 'tools-settings-actions');
      var save = element('button', 't-btn t-primary', 'Сохранить настройки'); save.type = 'button';
      save.addEventListener('click', saveSettings); saveButtons.push(save);
      var reset = element('button', 't-btn', 'Отменить изменения'); reset.type = 'button';
      reset.addEventListener('click', function () {
        if (busy) return;
        draft = copy(baseline); dirty = false; fill(); renderFlats(); loadSettings();
      });
      resetButtons.push(reset); bar.append(save, reset); return bar;
    }
    const actions=actionBar();actions.hidden=!!options.readOnly;
    host.append(status, guard, capSection, flatSection, actions);
    function allowed() { return !options.canSave || options.canSave(); }
    function message(text, error) { status.textContent = text; status.classList.toggle('tools-settings-error', !!error); }
    function controls() {
      var canSave = allowed();
      guard.hidden = canSave;
      saveButtons.forEach(function (button) {
        button.disabled = options.readOnly || busy || !canSave || (settingsReady && !dirty);
        button.textContent = busy ? 'Сохранение…' : settingsReady ? 'Сохранить настройки' : 'Загрузить настройки';
      });
      resetButtons.forEach(function (button) { button.disabled = busy || !dirty; });
      Object.values(inputs).forEach(function (input) { input.disabled = options.readOnly || busy || !settingsReady; });
      list.querySelectorAll('input').forEach(function (input) { input.disabled = options.readOnly || busy || !settingsReady; });
    }
    function fill() {
      Object.keys(inputs).forEach(function (project) {
        var value = draft.subsidyCompensation[project];
        inputs[project].value = value == null ? '' : String(Math.round(value * 10000) / 100);
      });
      controls();
    }
    function changed() {
      dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
      message(dirty ? 'Есть несохранённые изменения настроек.' : 'Настройки не изменены.');
      controls();
    }
    function renderFlats() {
      list.replaceChildren();
      if (!flatsLoaded) { controls(); return; }
      var query = normalize(search.value), flags = new Set(draft.specialFlats);
      var visible = rows.filter(function (row) {
        return (projectSelect.value === 'all' || (houseProjects[row.house_id] || 'other') === projectSelect.value) &&
          (!query || normalize(row.num).includes(query));
      });
      flatStatus.textContent = 'Показано квартир: ' + visible.length + ' из ' + rows.length + '. Отмечено: ' + flags.size + '.';
      if (!visible.length) list.append(element('p', 'tools-settings-hint', 'Квартиры не найдены. Измените фильтр или номер.'));
      visible.forEach(function (row) {
        var label = element('label', 'tools-settings-flat');
        var checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = flags.has(key(row));
        var projectName = projects[houseProjects[row.house_id]] || 'Дом ' + row.house_id;
        if (Number(row.house_id) === 10899161) projectName += ' · ПИФ';
        checkbox.setAttribute('aria-label', 'Специальные условия: ' + projectName + ', квартира № ' + row.num);
        checkbox.addEventListener('change', function () {
          var selected = new Set(draft.specialFlats);
          if (checkbox.checked) selected.add(key(row)); else selected.delete(key(row));
          draft.specialFlats = Array.from(selected).sort();
          changed();
          // Не пересоздаём строку: фокус остаётся на переключённом чекбоксе.
          list.querySelectorAll('input').forEach(function (input) { if (input.dataset.key === key(row)) input.checked = checkbox.checked; });
          flatStatus.textContent = 'Показано квартир: ' + visible.length + ' из ' + rows.length + '. Отмечено: ' + selected.size + '.';
        });
        checkbox.dataset.key = key(row);
        var description = element('span', 'tools-settings-flat-description');
        description.append(element('strong', '', '№ ' + row.num), element('span', '', projectName + ' · этаж ' + (row.floor || '—') + ' · ' + Number(row.area).toLocaleString('ru-RU') + ' м²'));
        var stateLabel = options.readOnly && !checkbox.checked ? 'Обычные условия' : 'Специальные условия';
        label.append(description, element('span', 'tools-settings-flat-label', stateLabel), checkbox); list.append(label);
      });
      controls();
    }
    async function loadFlats() {
      if (flatsBusy || flatsLoaded) return;
      flatsBusy = true; retry.hidden = true; flatStatus.textContent = 'Загрузка квартир из Macro…';
      try {
        var response = await fetch('assets/macro-flats.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('Список квартир недоступен.');
        var data = await response.json();
        if (!Array.isArray(data.rows)) throw new Error('Некорректный список квартир.');
        if (destroyed) return;
        rows = data.rows; flatsLoaded = true;
        if (rows.some(function (row) { return !houseProjects[row.house_id]; })) projectSelect.add(new Option('Другие дома', 'other'));
        renderFlats();
      } catch (e) { flatStatus.textContent = e.message; retry.hidden = false; }
      finally { flatsBusy = false; }
    }
    async function loadSettings() {
      if (busy || dirty || destroyed) return;
      busy = true; controls(); message('Загрузка настроек…');
      try {
        var result = await options.api('/api/settings');
        if (!result.settings || !result.revision) throw new Error('Не удалось прочитать версию настроек.');
        if (destroyed) return;
        revision = result.revision; baseline = defaults(result.settings); draft = copy(baseline); settingsReady = true;
        fill(); renderFlats(); message('Настройки загружены.');
      } catch (e) { message(e.message, true); }
      finally { busy = false; controls(); }
    }
    async function saveSettings() {
      if (options.readOnly || busy || destroyed) return;
      if (!allowed()) { message('Сначала сохраните или отмените изменения инструментов.', true); return; }
      if (!settingsReady) { await loadSettings(); return; }
      if (!dirty) return;
      var invalid = Object.keys(inputs).find(function (project) { return !inputs[project].checkValidity(); });
      if (invalid) { capSection.open = true; inputs[invalid].reportValidity(); message('Укажите компенсацию для каждого проекта: от 0 до 99%.', true); return; }
      busy = true; controls(); message('Сохранение настроек…');
      try {
        var result = await options.api('/api/settings', { revision: revision, settings: copy(draft) });
        if (!result.data || !result.data.settings || !result.data.revision) throw new Error('Сервер не подтвердил сохранённые настройки. Перечитайте их перед повтором.');
        if (destroyed) return;
        revision = result.data.revision; baseline = defaults(result.data.settings); draft = copy(baseline); dirty = false;
        // accepted() основного редактора очищает его черновики: при появлении новых правок его вызывать нельзя.
        var canAccept = allowed();
        if (canAccept && options.onSaved) await options.onSaved(result);
        initial = options.getData() || initial;
        if (root.SM_TOOLS_DATA) root.SM_TOOLS_DATA.settings = copy(baseline);
        if (root.SM_DATA) root.SM_DATA.settings = copy(baseline);
        root.dispatchEvent(new Event('sm-settings-changed'));
        fill(); renderFlats();
        message((result.published ? 'Настройки сохранены. Публикация запущена.' + (result.error ? ' ' + result.error : '') : 'Настройки сохранены. Публикация не завершена. ' + (result.error || 'Повторите публикацию в основном редакторе.')) +
          (canAccept ? '' : ' Черновики инструментов сохранены на экране; перед их отправкой требуется сверить версию каталога.'), !result.published || !!result.error);
      } catch (e) { message(e.message, true); }
      finally { busy = false; controls(); }
    }
    function refresh() {
      if (destroyed) return;
      var latest = options.getData() || {};
      // Принимаем только новую версию из основного редактора и только без своего черновика.
      if (!busy && !dirty && latest.revision && latest.revision !== initial.revision) {
        initial = latest; revision = latest.revision; baseline = defaults(latest.settings); draft = copy(baseline);
        fill(); renderFlats();
      }
      controls();
    }
    function beforeUnload(event) { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } }
    projectSelect.addEventListener('change', renderFlats); search.addEventListener('input', renderFlats);
    flatSection.addEventListener('toggle', function () { if (flatSection.open) loadFlats(); });
    retry.addEventListener('click', loadFlats);
    root.addEventListener('beforeunload', beforeUnload);
    function show(view){
      host.open=true;host.classList.toggle('tools-settings-tab',true);
      capSection.hidden=view==='flats';flatSection.hidden=view!=='flats';
      capSection.open=true;flatSection.open=view==='flats';
      if(view==='flats')loadFlats();
    }
    function flatFilter() { return { project: projectSelect.value, number: search.value }; }
    function setFlatFilter(filter) {
      projectSelect.value = Array.from(projectSelect.options).some(option => option.value === filter.project) ? filter.project : 'all';
      search.value = typeof filter.number === 'string' ? filter.number : '';
      renderFlats();
    }
    instance = { flatFilter, setFlatFilter, show:show, refresh: refresh, isDirty: function () { return dirty; }, isBusy: function () { return busy; }, destroy: function () {
      destroyed = true; root.removeEventListener('beforeunload', beforeUnload); host.remove(); instance = null;
    } };
    fill(); loadSettings();
    return instance;
  }
  root.SMToolsSettings = { setup: setup };
})(window);
