// Публичный каталог передаёт в личный редактор только выбранное действие.
(function () {
  'use strict';
  const site = 'https://evgeniigusv.github.io';
  const owner = 'http://127.0.0.1:8795';
  const $ = id => document.getElementById(id);
  const embedded = location.origin === owner && window.parent !== window;
  const sendParent = type => window.parent.postMessage({type}, site);
  let openAction;

  if (embedded) {
    document.body.classList.add('tools-embedded');
    $('owner-return').hidden = false;
    $('owner-return').onclick = () => sendParent('tools:close');
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) sendParent('tools:close');
    });
    window.addEventListener('message', event => {
      if (event.origin === site && event.source === window.parent && event.data?.type === 'tools:open' && openAction) {
        openAction(event.data.action);
      }
    });
    sendParent('tools:loading');
  }
  const dialog = $('owner-window');
  let frame, ready = false, action, timeout;
  function report(message, retry) {
    $('owner-progress').textContent = message;
    $('owner-recovery').hidden = !retry;
  }
  function start() {
    clearTimeout(timeout);
    if (frame) frame.remove();
    ready = false;
    frame = document.createElement('iframe');
    frame.title = 'Личный редактор инструментов';
    frame.allow = 'microphone; local-network-access; loopback-network';
    frame.hidden = true;
    frame.src = owner + '/tools.html';
    $('owner-connection').hidden = false;
    dialog.append(frame);
    report('Подключаем личный редактор на вашем Маке…', false);
    timeout = setTimeout(() => report('Нет связи с личным редактором. Откройте каталог на Маке владельца и разрешите браузеру доступ к локальной сети, если он запросит разрешение.', true), 9000);
  }
  function showFrame() {
    frame.hidden = false;
    $('owner-connection').hidden = true;
    frame.contentWindow.postMessage({type:'tools:open', action}, owner);
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
        report('Личный редактор открылся, но не смог загрузить каталог. Проверьте соединение и повторите.', true);
        break;
      case 'tools:close':
        dialog.close();
        break;
    }
  });
  $('owner-retry').onclick = start;
  $('owner-cancel').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (ready) event.preventDefault(); });
  window.SMOwnerWindow = {
    embedded,
    ready(handler) { if (embedded) { openAction = handler; sendParent('tools:ready'); } },
    failed() { if (embedded) sendParent('tools:failed'); },
    close() { if (embedded) sendParent('tools:close'); },
    open(next, title) {
      action = next;
      $('owner-action-title').textContent = title;
      const url = new URL('/tools.html', owner);
      if (next.project !== 'all') url.searchParams.set('project', next.project);
      if (next.section !== 'all') url.searchParams.set('section', next.section);
      if (next.id) url.searchParams.set(next.kind === 'add-project' ? 'template' : 'edit', next.id);
      if (next.kind === 'new' || next.kind === 'ai') url.hash = next.kind;
      $('owner-direct').href = url.href;
      dialog.showModal();
      if (ready) showFrame();
      else if (!frame || !$('owner-recovery').hidden) start();
    }
  };
})();
