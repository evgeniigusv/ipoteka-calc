// Применяем оформление до первого отображения страницы.
(() => {
  'use strict';
  const key = 'ipoteka-calc.theme';
  const root = document.documentElement;
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
      const page = link => new URL(link.href).pathname.replace(/index\.html$/, '');
      let previous;
      try {
        previous = JSON.parse(sessionStorage.getItem(navKey));
        sessionStorage.removeItem(navKey);
      } catch {}
      if (nav.scrollWidth > nav.clientWidth) {
        nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
      }
      if (!reduced.matches && previous?.to === page(active) && Date.now() - previous.time < 10000) {
        const from = links.find(link => page(link) === previous.from);
        if (from && from !== active) {
          active.style.setProperty('--pill-from-x', (from.offsetLeft - active.offsetLeft) + 'px');
          active.style.setProperty('--pill-from-scale', from.offsetWidth / active.offsetWidth);
          active.classList.add('sm-pill-arrive');
        }
      }
      nav.addEventListener('click', event => {
        const target = event.target.closest('a');
        if (!target || target === active || event.detail === 0 || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        try { sessionStorage.setItem(navKey, JSON.stringify({from: page(active), to: page(target), time: Date.now()})); } catch {}
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

  document.addEventListener('DOMContentLoaded', () => {
    const group = document.querySelector('.sm-theme-switch');
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
  });
})();
