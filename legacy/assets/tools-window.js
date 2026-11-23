// Закрытые записи, сессия и черновики остаются внутри локальной страницы.
(function () {
  'use strict';
  const owner = 'http://127.0.0.1:8795';
  const site = new URLSearchParams(location.search).get('parent') === 'local' ? owner : 'https://evgeniigusv.github.io';
  const $ = id => document.getElementById(id);
  const embedded = location.origin === owner && window.parent !== window;
  const theme = () => document.documentElement.dataset.theme;

  const pointerInput = () => document.documentElement.dataset.smInput === 'pointer';
  function markEntrance(element, pointer) {
    element.dataset.ownerEntry = pointer ? 'pointer' : 'instant';
  }

  // Некоторые браузеры оставляют фокус в поиске при нажатии кнопки мышью.
  $('public-catalog').addEventListener('click', event => {
    const trigger = event.target.closest('#tools-owner-link, #tools-settings-edit, #tools-add, #tools-ai, [data-edit], [data-copy], [data-new-project]');
    if (trigger && trigger !== document.activeElement) trigger.focus({preventScroll:true});
  }, true);

  const editor = $('tools-editor');
  let returnRecord;
  const dialogs = [editor, $('ai-dialog')];
  for (const dialog of dialogs) {
    dialog.addEventListener('click', event => {
      if (event.detail > 0 && pointerInput() && !window.SMProposals?.isTransitioning() &&
          event.target.closest('#tools-cancel, #tools-close, #ai-close')) {
        dialog.dataset.ownerExit = 'pointer';
      }
    }, true);
    dialog.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      for (const layer of dialogs) {
        if (!layer.hasAttribute('data-owner-exit')) continue;
        delete layer.dataset.ownerExit;
        // Убираем и отложенное снятие из верхнего слоя до следующего showModal.
        for (const effect of layer.getAnimations({subtree:true})) {
          if (effect instanceof CSSTransition && effect.effect.target === layer) effect.cancel();
        }
      }
      markEntrance(dialog, pointerInput());
      if (dialog === editor) returnRecord = document.activeElement.closest('[data-record]')?.dataset.record;
    });
  }
  // После сохранения каталог заново создаёт строки, включая кнопку, открывшую форму.
  editor.addEventListener('close', () => {
    if (document.querySelector('dialog[open]') || window.SMProposals?.isTransitioning()) return;
    // В Яндекс Браузере при событии close фокус ещё может быть внутри закрытой формы.
    const focused = document.activeElement;
    if (focused !== document.body && !editor.contains(focused)) return;
    const edit = returnRecord && document.querySelector('[data-edit="' + CSS.escape(returnRecord) + '"]');
    (edit || $('tools-add')).focus({preventScroll:true});
  });

  // Escape сворачивает ближайшее раскрытие до выхода из формы или панели.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (event.target.closest('[role="combobox"], [role="listbox"]')) return;
    const select = event.target.closest('select');
    if (select && (!CSS.supports('selector(select:open)') || select.matches(':open'))) return;
    const details = event.target.closest('details[open]');
    if (!details || !details.closest('#public-catalog, #tools-editor, #ai-dialog')) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary || !summary.getClientRects().length) return;
    event.preventDefault();
    details.removeAttribute('data-pointer-disclosure');
    details.open = false;
    summary.focus({preventScroll:true});
  });

  if (embedded) {
    const send = (type, details = {}) => window.parent.postMessage({type, ...details}, site);
    document.body.classList.add('tools-embedded');
    const exit = $('owner-return');
    document.querySelector('.tools-view-tabs').append(exit);
    exit.hidden = false;
    exit.onclick = () => send('tools:close', {pointer:pointerInput()});
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) send('tools:close');
    });
    let openAction;
    window.addEventListener('message', event => {
      if (event.origin !== site || event.source !== window.parent) return;
      const message = event.data;
      if (message?.type === 'tools:theme') {
        window.SMTheme.set(message.theme);
        send('tools:theme-applied', {theme:theme()});
        return;
      }
      if (message?.type !== 'tools:open' || !openAction || document.querySelector('dialog[open]') || window.SMProposals?.isTransitioning()) return;
      window.SMTheme?.set(message.theme);
      document.documentElement.dataset.smInput = message.pointer === true ? 'pointer' : 'keyboard';
      exit.focus({preventScroll:true});
      openAction(message.action);
    });
    window.SMOwnerWindow = {
      embedded,
      ready(handler) { openAction = handler; send('tools:ready', {theme:theme()}); },
      failed(reason) { send('tools:failed', {reason}); },
      viewChanged(view) { send('tools:view', {view}); },
      close() { send('tools:close'); }
    };
    send('tools:loading');
    return;
  }

  const panel = $('owner-window');
  let frame, frameTheme, themePending = false, ready = false, action, timeout, delivered = false, trigger, scroll, publicTitle;
  function report(message, retry) {
    $('owner-progress').textContent = message;
    $('owner-recovery').hidden = !retry;
  }
  function start() {
    clearTimeout(timeout);
    frame?.remove();
    ready = delivered = themePending = false;
    frameTheme = undefined;
    frame = document.createElement('iframe');
    frame.title = 'Личный редактор инструментов';
    frame.allow = 'microphone; local-network-access; loopback-network';
    frame.hidden = true;
    frame.src = owner + '/tools.html?theme=' + theme() + '&open=' + Date.now() + (location.origin === owner ? '&parent=local' : '');
    markEntrance(panel, pointerInput());
    $('owner-connection').hidden = false;
    panel.append(frame);
    report('Подключаем личный редактор на вашем Маке…', false);
    $('owner-cancel').focus({preventScroll:true});
    timeout = setTimeout(() => report('Нет связи с личным редактором. Откройте каталог на Маке владельца и разрешите браузеру доступ к локальной сети, если он запросит разрешение.', true), 9000);
  }
  function syncFrameTheme() {
    if (!ready || themePending || frameTheme === theme()) return;
    // Старый экземпляр редактора не передавал тему в tools:ready и не отвечал на обновление.
    themePending = Boolean(frameTheme);
    frame.contentWindow.postMessage({type:'tools:theme', theme:theme()}, owner);
  }
  function showFrame() {
    if (panel.hidden || delivered) return;
    // Пока редактор загружался или был свёрнут, оформление могло измениться.
    if (themePending || (frameTheme && frameTheme !== theme())) {
      syncFrameTheme();
      return;
    }
    markEntrance(panel, pointerInput());
    frame.hidden = false;
    $('owner-connection').hidden = true;
    delivered = true;
    frame.contentWindow.postMessage({type:'tools:open', action, theme:theme(), pointer:pointerInput()}, owner);
    frame.focus({preventScroll:true});
  }
  function close(pointer) {
    if (panel.hidden) return;
    clearTimeout(timeout);
    panel.hidden = true;
    if (frame) frame.hidden = true;
    delivered = false;
    delete $('public-catalog').dataset.viewMotion;
    markEntrance($('public-catalog'), pointer);
    $('public-catalog').hidden = false;
    document.querySelector('.tools-mast h1').textContent = publicTitle;
    trigger.focus({preventScroll:true});
    window.scrollTo(0, scroll);
  }
  window.addEventListener('message', event => {
    if (!frame || event.origin !== owner || event.source !== frame.contentWindow) return;
    switch (event.data?.type) {
      case 'tools:loading':
        clearTimeout(timeout);
        report('Редактор подключён. Загружаем условия инструментов…', false);
        timeout = setTimeout(() => report('Каталог пока не ответил. Можно подождать или повторить загрузку.', true), 45000);
        break;
      case 'tools:ready':
        clearTimeout(timeout);
        ready = true;
        frameTheme = event.data.theme;
        showFrame();
        break;
      case 'tools:theme-applied':
        frameTheme = event.data.theme;
        themePending = false;
        syncFrameTheme();
        if (ready) showFrame();
        break;
      case 'tools:failed':
        clearTimeout(timeout);
        ready = delivered = false;
        frame.hidden = true;
        $('owner-connection').hidden = false;
        report('Не удалось загрузить каталог. '+(typeof event.data.reason==='string'?event.data.reason.slice(0,300)+' ':'')+'Нажмите «Повторить», чтобы загрузить редактор заново.', true);
        break;
      case 'tools:view': {
        const view = event.data.view;
        if (delivered && ['catalog','flats','compensation'].includes(view)) {
          document.querySelector('.tools-mast h1').textContent = document.querySelector('[data-tools-view="'+view+'"]').textContent;
        }
        break;
      }
      case 'tools:close':
        close(event.data.pointer === true);
        break;
    }
  });
  function syncTheme() {
    const direct = $('owner-direct');
    if (!panel.hidden && direct.href) {
      const url = new URL(direct.href);
      url.searchParams.set('theme', theme());
      direct.href = url.href;
    }
    syncFrameTheme();
  }
  new MutationObserver(syncTheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
  window.addEventListener('pageshow', event => { if (event.persisted) syncTheme(); });
  $('owner-retry').onclick = start;
  $('owner-cancel').onclick = () => close(pointerInput());
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') close(false);
  });
  window.SMOwnerWindow = {
    embedded, ready() {}, failed() {},
    open(next, title) {
      if (!panel.hidden || document.querySelector('dialog[open]')) return;
      action = next;
      scroll = window.scrollY;
      publicTitle = document.querySelector('.tools-mast h1').textContent;
      trigger = document.activeElement;
      $('owner-action-title').textContent = title;
      const url = new URL('/tools.html', owner);
      url.searchParams.set('theme', theme());
      url.searchParams.set('mode','edit');
      if (['flats','compensation'].includes(next.kind)) url.searchParams.set('view',next.kind);
      if (next.project !== 'all') url.searchParams.set('project', next.project);
      if (next.section !== 'all') url.searchParams.set('section', next.section);
      if (next.query) url.searchParams.set('query',next.query);
      if (next.id) url.searchParams.set(next.kind === 'add-project' ? 'template' : 'edit', next.id);
      if (next.kind === 'new' || next.kind === 'ai') url.hash = next.kind;
      $('owner-direct').href = url.href;
      $('public-catalog').hidden = true;
      panel.hidden = false;
      if (ready) showFrame();
      else start();
    }
  };
})();
