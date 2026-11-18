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

  let sectionLink = null;
  window.addEventListener('pageswap', event => {
    if (!sectionLink || sectionLink.href !== event.activation?.entry?.url) event.viewTransition?.skipTransition();
    sectionLink = null;
  });
  // Вызывается сразу после разметки навигации, до загрузки скриптов расчёта.
  window.SMNavigation = {
    mount(nav) {
      if (!nav || window.parent !== window) return;
      const active = nav.querySelector('[aria-current="page"]');
      if (!active) return;
      const navKey = 'ipoteka-calc.navigation';
      const links = [...nav.querySelectorAll('a')];
      for (const link of links) {
        const target = new URL(link.href);
        target.searchParams.set('theme', root.dataset.theme);
        link.href = target.href;
      }
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      const pill = document.createElement('span');
      pill.className = 'sm-nav-indicator';
      pill.setAttribute('aria-hidden', 'true');
      active.prepend(pill);

      // Координаты относительно строки остаются общими для обеих HTML-страниц.
      function bounds(element) {
        const box = element.getBoundingClientRect();
        return {left:box.left - nav.getBoundingClientRect().left, width:box.width};
      }
      let pending = null;
      let incoming = null;
      try {
        const trip = JSON.parse(sessionStorage.getItem(navKey));
        sessionStorage.removeItem(navKey);
        if (trip?.to === location.href && trip.width === nav.clientWidth &&
            performance.getEntriesByType('navigation')[0]?.type === 'navigate') incoming = trip;
      } catch { /* Ссылки работают и без хранилища. */ }

      function arrive() {
        if (!incoming || reduced.matches) return;
        const from = incoming.from;
        incoming = null;
        const to = bounds(active);
        if (!Number.isFinite(from?.left) || !(from.width > 0 && to.width > 0)) return;
        pill.animate([
          {transform: 'translateX(' + (from.left - to.left) + 'px) scaleX(' + from.width / to.width + ')'},
          {transform: 'none'}
        ], {duration: 210, easing: 'cubic-bezier(.22,.68,.25,1)'});
      }
      window.addEventListener('pagereveal', event => {
        const transition = event.viewTransition;
        if (!transition || !incoming || reduced.matches) { transition?.skipTransition(); arrive(); return; }
        root.dataset.smRoute = incoming.backwards ? 'backwards' : 'forwards';
        root.dataset.smRouteWaiting = '';
        // На экране остаётся снимок предыдущей вкладки, пока строится первый расчёт.
        // Даже при сетевой ошибке браузер вовремя покажет штатное состояние загрузки.
        let timer;
        const release = () => {
          if (!root.hasAttribute('data-sm-route-waiting')) return;
          clearTimeout(timer);
          delete root.dataset.smRouteWaiting;
          arrive();
        };
        timer = setTimeout(release, 450);
        function catalogReady() { Promise.resolve(window.SM_TOOLS_READY).then(release, release); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', catalogReady, {once:true});
        else catalogReady();
        transition.finished.then(() => { release(); delete root.dataset.smRoute; });
      });
      window.addEventListener('pageshow', event => {
        pending = null;
        if (!event.persisted && !('onpagereveal' in window)) arrive();
      });
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
        if (event.detail === 0 || reduced.matches) return;
        sectionLink = pending = target;
        try {
          sessionStorage.setItem(navKey, JSON.stringify({from:bounds(active), to:target.href, width:nav.clientWidth, backwards:links.indexOf(target) < links.indexOf(active)}));
        } catch {}
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
