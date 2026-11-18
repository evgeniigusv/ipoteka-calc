// Закрытые записи, сессия и черновики остаются внутри локальной страницы.
(function () {
  'use strict';
  const owner = 'http://127.0.0.1:8795';
  const site = new URLSearchParams(location.search).get('parent') === 'local' ? owner : 'https://evgeniigusv.github.io';
  const $ = id => document.getElementById(id);
  const embedded = location.origin === owner && window.parent !== window;
  const theme = () => document.documentElement.dataset.theme;

  if (embedded) {
    const send = (type, details = {}) => window.parent.postMessage({type, ...details}, site);
    document.body.classList.add('tools-embedded');
    const exit = $('owner-return');
    document.querySelector('.tools-view-tabs').append(exit);
    exit.hidden = false;
    exit.onclick = () => send('tools:close');
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) send('tools:close');
    });
    let openAction;
    window.addEventListener('message', event => {
      if (event.origin !== site || event.source !== window.parent) return;
      const message = event.data;
      if (message?.type === 'tools:theme') window.SMTheme?.set(message.theme);
      if (message?.type !== 'tools:open' || !openAction || document.querySelector('dialog[open]') || window.SMProposals?.isTransitioning()) return;
      window.SMTheme?.set(message.theme);
      openAction(message.action);
      if (!document.querySelector('dialog[open]')) exit.focus({preventScroll:true});
    });
    window.SMOwnerWindow = {
      embedded,
      ready(handler) { openAction = handler; send('tools:ready'); },
      failed(reason) { send('tools:failed', {reason}); },
      viewChanged(view) { send('tools:view', {view}); },
      close() { send('tools:close'); }
    };
    send('tools:loading');
    return;
  }

  const panel = $('owner-window');
  let frame, ready = false, action, timeout, delivered = false, trigger, scroll, publicTitle;
  function report(message, retry) {
    $('owner-progress').textContent = message;
    $('owner-recovery').hidden = !retry;
  }
  function start() {
    clearTimeout(timeout);
    frame?.remove();
    ready = delivered = false;
    frame = document.createElement('iframe');
    frame.title = 'Личный редактор инструментов';
    frame.allow = 'microphone; local-network-access; loopback-network';
    frame.hidden = true;
    frame.src = owner + '/tools.html?theme=' + theme() + '&open=' + Date.now() + (location.origin === owner ? '&parent=local' : '');
    $('owner-connection').hidden = false;
    panel.append(frame);
    report('Подключаем личный редактор на вашем Маке…', false);
    timeout = setTimeout(() => report('Нет связи с личным редактором. Откройте каталог на Маке владельца и разрешите браузеру доступ к локальной сети, если он запросит разрешение.', true), 9000);
  }
  function showFrame() {
    if (panel.hidden || delivered) return;
    frame.hidden = false;
    $('owner-connection').hidden = true;
    delivered = true;
    frame.contentWindow.postMessage({type:'tools:open', action, theme:theme()}, owner);
    frame.focus({preventScroll:true});
  }
  function close() {
    if (panel.hidden) return;
    clearTimeout(timeout);
    panel.hidden = true;
    delivered = false;
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
        showFrame();
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
        close();
        break;
    }
  });
  new MutationObserver(() => {
    if (delivered) frame.contentWindow.postMessage({type:'tools:theme', theme:theme()}, owner);
  }).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
  $('owner-retry').onclick = start;
  $('owner-cancel').onclick = close;
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
      else { start(); $('owner-cancel').focus({preventScroll:true}); }
    }
  };
})();
