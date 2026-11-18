// Применяем оформление до первого отображения страницы.
(() => {
  'use strict';
  const key = 'ipoteka-calc.theme';
  const root = document.documentElement;
  function inputMode(mode) {
    if (root.dataset.smInput !== mode) root.dataset.smInput = mode;
  }
  document.addEventListener('pointerdown', () => inputMode('pointer'), { capture: true, passive: true });
  document.addEventListener('keydown', () => inputMode('keyboard'), true);
  const url = new URL(location.href);
  const requested = url.searchParams.get('theme');
  const valid = value => value === 'classic' || value === 'sm';
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Хранилище может быть отключено. */ }

  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'sm' ? '#2F2F2F' : '#355DB3';
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
    });
  }
  function remember(theme) {
    try { localStorage.setItem(key, theme); } catch { /* Ссылки сохраняют выбор и без хранилища. */ }
  }
  const initial = valid(requested) ? requested : valid(saved) ? saved : 'classic';
  apply(initial);
  if (valid(requested) && window === window.parent) remember(initial);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const navTripKey = 'ipoteka-calc.section-click';
  let sectionLink = null;
  let arrivingSnapshot = null;
  document.addEventListener('click', event => {
    if (!event.detail || reducedMotion.matches) return;
    const button = event.target.closest('.sm-pills button, .sm-theme-switch button, .sm-actions button, .tools-pills button, .tools-view-tabs button, .tools-toolbar-actions button');
    if (!button || button.disabled) return;
    for (const effect of button.getAnimations()) if (effect.id === 'sm-button-release') effect.cancel();
    button.animate([{transform:'scale(.94)'}, {transform:'scale(1.02)',offset:.66}, {transform:'none'}],
      {id:'sm-button-release', duration:240, easing:'cubic-bezier(.2,.7,.3,1)'});
  }, true);
  window.addEventListener('pageswap', event => {
    if (!sectionLink || sectionLink.href !== event.activation?.entry?.url) event.viewTransition?.skipTransition();
    sectionLink = null;
  });
  window.addEventListener('pagereveal', event => {
    const snapshot = event.viewTransition;
    if (!snapshot) return;
    arrivingSnapshot = snapshot;
    snapshot.ready.catch(() => {}); // Быстрая загрузка может завершиться до создания снимка.
    // Готовые разделы сменяют друг друга за один кадр. При медленной сети показываем загрузку.
    const showPage = () => snapshot.skipTransition();
    const timer = setTimeout(showPage, 450);
    snapshot.finished.then(() => clearTimeout(timer));
    const whenParsed = () => Promise.resolve(window.SM_TOOLS_READY).then(showPage, showPage);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenParsed, {once:true});
    else whenParsed();
  });
  // Вызывается сразу после разметки навигации, до загрузки скриптов расчёта.
  window.SMNavigation = {
    mount(nav) {
      if (!nav || window.parent !== window) return;
      const active = nav.querySelector('[aria-current="page"]');
      if (!active) return;
      const links = [...nav.querySelectorAll('a')];
      for (const link of links) {
        const target = new URL(link.href);
        target.searchParams.set('theme', root.dataset.theme);
        link.href = target.href;
      }
      const pill = document.createElement('span');
      pill.className = 'sm-nav-indicator';
      pill.setAttribute('aria-hidden', 'true');
      active.prepend(pill);

      let trip;
      try {
        trip = JSON.parse(sessionStorage.getItem(navTripKey));
        sessionStorage.removeItem(navTripKey);
      } catch { /* Навигация работает и без хранилища. */ }
      if (trip?.to === location.href && links[trip.from] && !reducedMotion.matches &&
          performance.getEntriesByType('navigation')[0]?.type === 'navigate') {
        const start = links[trip.from].getBoundingClientRect(), end = active.getBoundingClientRect();
        if (start.width && end.width) {
          const timing = {duration:320, easing:'cubic-bezier(.2,.7,.22,1)', fill:'backwards'};
          const travel = pill.animate([
            {transform:'translateX(' + (start.left-end.left) + 'px) scaleX(' + start.width/end.width + ')',backgroundColor:'color-mix(in srgb, var(--blue, var(--sky)) 40%, white)'},
            {transform:'none'}
          ], {...timing,id:'sm-section-indicator'});
          const ink = active.animate([{color:'var(--grey)'},{color:'var(--grey)',offset:.55},{}], timing);
          travel.pause(); ink.pause();
          const reveal = () => {
            if (reducedMotion.matches) { travel.cancel(); ink.cancel(); return; }
            travel.play(); ink.play();
            const panel = document.querySelector('main.sm > .sm-grid, #public-catalog');
            panel?.animate([{opacity:.48},{opacity:1}], {id:'sm-section-content', duration:270,easing:'ease-out'});
          };
          // Первый кадр готов после разбора разметки; фоновые ресурсы могут грузиться дольше.
          const onPaint = () => requestAnimationFrame(() => {
            if (arrivingSnapshot) arrivingSnapshot.finished.then(reveal);
            else reveal();
          });
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onPaint, {once:true});
          else onPaint();
        }
      }

      let pending = null;
      window.addEventListener('pageshow', () => { pending = null; });
      window.navigation?.addEventListener('navigate', event => {
        if (pending?.href === event.destination.url) {
          event.signal.addEventListener('abort', () => { pending = null; }, {once:true});
        }
      });
      nav.addEventListener('click', event => {
        const target = event.target.closest('a');
        if (!target || event.defaultPrevented || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (target === active) {
          event.preventDefault();
          // Верхняя ссылка «Инструменты» возвращает из подраздела в общий каталог.
          const catalog = document.querySelector('#public-catalog:not([hidden]) [data-tools-view="catalog"][aria-pressed="false"]');
          catalog?.click();
          return;
        }
        if (target === pending) {
          event.preventDefault();
          return;
        }
        if (event.detail === 0 || reducedMotion.matches) return;
        sectionLink = pending = target;
        try { sessionStorage.setItem(navTripKey, JSON.stringify({from:links.indexOf(active),to:target.href})); } catch {}

      });
      // Прогреваем только публичную HTML-страницу, на которую нацелился пользователь.
      const prefetched = new Set();
      const publicSite = location.hostname === 'evgeniigusv.github.io';
      function warm(event) {
        const target = event.target.closest('a');
        if (!publicSite || !target || target === active || navigator.connection?.saveData) return;
        const url = new URL(target.href);
        url.searchParams.set('theme', root.dataset.theme);
        if (prefetched.has(url.href)) return;
        const hint = document.createElement('link');
        hint.rel = 'prefetch';
        hint.href = url.href;
        document.head.append(hint);
        prefetched.add(url.href);
      }
      nav.addEventListener('pointerover', warm);
      nav.addEventListener('focusin', warm);
      nav.addEventListener('pointerdown', warm, {passive: true});
    }
  };

  function mountThemeSwitch(group) {
    const nav = document.querySelector('.sm-navigation');
    function update(theme) {
      apply(theme);
      for (const link of nav.querySelectorAll('a')) {
        const target = new URL(link.href);
        target.searchParams.set('theme', theme);
        link.href = target.href;
      }
    }
    window.SMTheme={set(theme){
      if(!valid(theme))return;
      update(theme);
      const current=new URL(location.href);current.searchParams.set('theme',theme);
      history.replaceState(history.state,'',current);
    }};
    update(initial);
    group.hidden = false;
    group.addEventListener('click', event => {
      const choice = event.target.closest('[data-theme-choice]')?.dataset.themeChoice;
      if (!valid(choice)) return;
      update(choice);
      remember(choice);
      const current = new URL(location.href);
      current.searchParams.set('theme', choice);
      history.replaceState(history.state, '', current);
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && !valid(new URL(location.href).searchParams.get('theme'))) {
        try { const value = localStorage.getItem(key); if (valid(value)) update(value); } catch {}
      }
    });
  }
  // Переключатель занимает своё место до первого кадра, даже если скрипты расчёта ещё загружаются.
  const switchObserver = new MutationObserver(() => {
    const lastChoice = document.querySelector('.sm-theme-switch [data-theme-choice="sm"]');
    if (!lastChoice) return;
    switchObserver.disconnect();
    mountThemeSwitch(lastChoice.closest('.sm-theme-switch'));
  });
  switchObserver.observe(root, {childList:true, subtree:true});
})();

// Выбор общий для калькуляторов в этой вкладке. Восстанавливаем его до вывода полей.
window.SMFieldNotes = function (checkbox) {
  const key = 'ipoteka-calc.field-notes';
  function restore() {
    try { checkbox.checked = sessionStorage.getItem(key) === 'show'; } catch {}
  }
  restore();
  checkbox.addEventListener('change', () => {
    try { sessionStorage.setItem(key, checkbox.checked ? 'show' : 'hide'); } catch {}
  });
  window.addEventListener('pageshow', event => { if (event.persisted) restore(); });
};
