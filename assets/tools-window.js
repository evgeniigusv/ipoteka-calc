// Публичный каталог передаёт в личный редактор только выбранное действие.
(function () {
  'use strict';
  const site = 'https://evgeniigusv.github.io';
  const owner = 'http://127.0.0.1:8795';
  const $ = id => document.getElementById(id);
  const embedded = location.origin === owner && window.parent !== window;
  const sendParent = (type, details = {}) => window.parent.postMessage({type, ...details}, site);
  let openAction;

  if (embedded) {
    document.body.classList.add('tools-embedded');
    $('owner-return').hidden = false;
    $('owner-return').onclick = () => sendParent('tools:close');
    // The iframe is a transport container. Show its catalog only outside an editor,
    // so the user sees one heading and one active dialog during an action.
    const shell = document.querySelector('.tools-shell');
    const syncShell = () => {
      const modal = document.querySelector('dialog[open]');
      if (shell) shell.hidden = !!modal;
    };
    const observer = new MutationObserver(syncShell);
    document.querySelectorAll('dialog').forEach(d => observer.observe(d, {attributes:true, attributeFilter:['open']}));
    syncShell();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) sendParent('tools:close');
    });
    window.addEventListener('message', event => {
      if (event.origin === site && event.source === window.parent && event.data?.type === 'tools:open' && openAction) {
        if (document.querySelector('dialog[open]') || window.SMProposals?.isTransitioning()) return;
        window.SMTheme?.set(event.data.theme);
        openAction(event.data.action);
      }
    });
    sendParent('tools:loading');
  }
  const dialog = $('owner-window');
  let frame, ready = false, action, timeout, delivered = false;
  function visibility(element, visible) {
    element.hidden = !visible;
    // #owner-window iframe {display:block} otherwise overrides the hidden attribute.
    element.style.display = visible ? '' : 'none';
  }
  function report(message, retry) {
    $('owner-progress').textContent = message;
    $('owner-recovery').hidden = !retry;
  }
  function start() {
    clearTimeout(timeout);
    if (frame) frame.remove();
    ready = false;
    delivered = false;
    frame = document.createElement('iframe');
    frame.title = 'Личный редактор инструментов';
    frame.allow = 'microphone; local-network-access; loopback-network';
    visibility(frame, false);
    frame.src = owner + '/tools.html?theme=' + document.documentElement.dataset.theme + '&open=' + Date.now();
    visibility($('owner-connection'), true);
    dialog.append(frame);
    report('Подключаем личный редактор на вашем Маке…', false);
    timeout = setTimeout(() => report('Нет связи с личным редактором. Откройте каталог на Маке владельца и разрешите браузеру доступ к локальной сети, если он запросит разрешение.', true), 9000);
  }
  function showFrame() {
    if (!dialog.open || delivered) return;
    visibility(frame, true);
    visibility($('owner-connection'), false);
    delivered = true;
    frame.contentWindow.postMessage({type:'tools:open', action, theme:document.documentElement.dataset.theme}, owner);
    frame.focus();
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
        if (dialog.open) showFrame();
        break;
      case 'tools:failed':
        clearTimeout(timeout);
        ready = false;
        delivered = false;
        visibility(frame, false);
        visibility($('owner-connection'), true);
        report('Не удалось загрузить каталог. '+(typeof event.data.reason==='string'?event.data.reason.slice(0,300)+' ':'')+'Нажмите «Повторить», чтобы загрузить редактор заново.', true);
        break;
      case 'tools:close':
        dialog.close();
        break;
    }
  });
  $('owner-retry').onclick = start;
  $('owner-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { clearTimeout(timeout); delivered = false; });
  dialog.addEventListener('cancel', event => { if (ready) event.preventDefault(); });
  window.SMOwnerWindow = {
    embedded,
    ready(handler) { if (embedded) { openAction = handler; sendParent('tools:ready'); } },
    failed(reason) { if (embedded) sendParent('tools:failed', {reason}); },
    close() { if (embedded) sendParent('tools:close'); },
    open(next, title) {
      if (dialog.open) { if (ready) frame?.focus(); return; }
      if (document.querySelector('dialog[open]')) return;
      action = next;
      $('owner-action-title').textContent = title;
      const url = new URL('/tools.html', owner);
      url.searchParams.set('theme', document.documentElement.dataset.theme);
      if(['flats','compensation'].includes(next.kind))url.searchParams.set('view',next.kind);
      if (next.project !== 'all') url.searchParams.set('project', next.project);
      if (next.section !== 'all') url.searchParams.set('section', next.section);
      if (next.id) url.searchParams.set(next.kind === 'add-project' ? 'template' : 'edit', next.id);
      if (next.kind === 'new' || next.kind === 'ai') url.hash = next.kind;
      $('owner-direct').href = url.href;
      if (!dialog.open) dialog.showModal();
      if (ready) showFrame();
      else if (!frame || !$('owner-recovery').hidden) start();
    }
  };
})();
