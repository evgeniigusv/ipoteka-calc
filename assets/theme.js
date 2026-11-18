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

  const motionAllowed = matchMedia('screen and (prefers-reduced-motion: no-preference)');
  // Web Animations принимает время в миллисекундах, а CSS допускает и секунды.
  function motionTiming(durationToken, easingToken, fallbackMs) {
    const style = getComputedStyle(root);
    const time = style.getPropertyValue('--sm-motion-' + durationToken).trim();
    const ms = parseFloat(time) * (time.endsWith('ms') ? 1 : 1000);
    return {
      duration: Number.isFinite(ms) ? ms : fallbackMs,
      easing: style.getPropertyValue('--sm-ease-' + easingToken).trim() || 'ease-out'
    };
  }
  const navTripKey = 'ipoteka-calc.section-click';
  motionAllowed.addEventListener('change', () => {
    if (motionAllowed.matches) return;
    const ids = ['sm-button-release', 'sm-section-indicator', 'sm-section-ink'];
    for (const effect of document.getAnimations()) {
      if (ids.includes(effect.id)) effect.cancel();
    }
  });
  document.addEventListener('click', event => {
    if (!event.detail || !motionAllowed.matches) return;
    const button = event.target.closest('.sm-pills button, .sm-theme-switch button, .sm-actions button, .tools-pills button, .tools-view-tabs button, .tools-toolbar-actions button');
    if (!button || button.disabled || button.getAttribute('aria-pressed') === 'true') return;
    const transform = getComputedStyle(button).transform;
    for (const effect of button.getAnimations()) if (effect.id === 'sm-button-release') effect.cancel();
    button.animate([{transform}, {transform:'none'}],
      {id:'sm-button-release', ...motionTiming('press', 'enter', 120)});
  }, true);
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
        // Ссылка на выпуск открывает один и тот же выпуск оформления во всех разделах.
        const release = url.searchParams.get('v');
        if (release) target.searchParams.set('v', release);
        link.href = target.href;
      }
      const pill = document.createElement('span');
      pill.className = 'sm-nav-indicator';
      pill.setAttribute('aria-hidden', 'true');
      active.prepend(pill);

      let pending = null;
      let travel = null;
      let ink = null;
      const now = () => performance.timeOrigin + performance.now();

      // Положение выражено в долях ширины меню, чтобы продолжить движение в новом документе.
      function position(rect) {
        const box = nav.getBoundingClientRect();
        return {x:(rect.left - box.left) / box.width, width:rect.width / box.width};
      }
      function glide(target, trip) {
        travel?.cancel();
        ink?.cancel();
        nav.dataset.travelling = '';
        nav.querySelector('[data-destination]')?.removeAttribute('data-destination');
        target.dataset.destination = '';
        target.prepend(pill);
        const timing = motionTiming('navigation', 'navigation', 200);
        const elapsed = Math.max(0, now() - trip.started);
        if (!motionAllowed.matches || elapsed >= timing.duration) return;
        const box = nav.getBoundingClientRect(), end = target.getBoundingClientRect();
        if (!box.width || !end.width) return;
        const dx = box.left + trip.x * box.width - end.left;
        const scale = trip.width * box.width / end.width;
        travel = pill.animate([
          {transform:'translateX(' + dx + 'px) scaleX(' + scale + ')'},
          {transform:'none'}
        ], {id:'sm-section-indicator', ...timing});
        // Пока плашка ещё в пути, подпись цели остаётся читаемой на светлом фоне.
        ink = target.animate([{color:'var(--grey)'}, {color:'var(--grey)', offset:.55}, {}],
          {id:'sm-section-ink', ...timing});
        travel.currentTime = ink.currentTime = elapsed;
      }
      function restore() {
        pending = null;
        travel?.cancel();
        ink?.cancel();
        travel = null;
        delete nav.dataset.travelling;
        nav.querySelector('[data-destination]')?.removeAttribute('data-destination');
        active.prepend(pill);
        try { sessionStorage.removeItem(navTripKey); } catch {}
      }

      let trip;
      try {
        trip = JSON.parse(sessionStorage.getItem(navTripKey));
        sessionStorage.removeItem(navTripKey);
      } catch {}
      if (trip?.to === location.href && Number.isFinite(trip.x) && trip.width > 0 &&
          now() - trip.started < 15000 && motionAllowed.matches &&
          performance.getEntriesByType('navigation')[0]?.type === 'navigate') {
        root.style.setProperty('--sm-enter-offset', trip.direction === -1 ? '-8px' : '8px');
        root.classList.add('sm-arriving');
        glide(active, trip);
        const settle = () => {
          if (!pending) {
            delete nav.dataset.travelling;
            delete active.dataset.destination;
          }
        };
        if (travel) travel.finished.then(settle, () => {});
        else settle();
      }
      window.addEventListener('pageshow', event => {
        if (event.persisted) {
          root.classList.remove('sm-arriving');
          restore();
        }
      });
      window.navigation?.addEventListener('navigate', event => {
        const link = pending;
        if (link?.href === event.destination.url) {
          event.signal.addEventListener('abort', () => { if (pending === link) restore(); }, {once:true});
        }
      });
      nav.addEventListener('click', event => {
        const target = event.target.closest('a');
        if (!target || event.defaultPrevented || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (target === active) {
          event.preventDefault();
          if (pending) {
            window.stop();
            restore();
            return;
          }
          // Верхняя ссылка «Инструменты» возвращает из подраздела в общий каталог.
          const catalog = document.querySelector('#public-catalog:not([hidden]) [data-tools-view="catalog"][aria-pressed="false"]');
          catalog?.click();
          return;
        }
        if (target === pending) {
          event.preventDefault();
          return;
        }
        if (event.detail === 0 || !motionAllowed.matches) return;
        const journey = {...position(pill.getBoundingClientRect()), started:now(), to:target.href,
          direction: Math.sign(links.indexOf(target) - links.indexOf(active))};
        pending = target;
        glide(target, journey);
        try { sessionStorage.setItem(navTripKey, JSON.stringify(journey)); } catch {}

      });
      // Читаем только публичную оболочку. Документ попадёт в обычный HTTP-кэш браузера,
      // а ссылки из инертного шаблона позволят заранее получить оформление и код раздела.
      const prefetched = new Set();
      const publicSite = location.hostname === 'evgeniigusv.github.io';
      const assetBase = new URL('assets/', location.href);
      async function warm(target) {
        if (!publicSite || !target || target === active || navigator.connection?.saveData) return;
        const href = target.href;
        if (prefetched.has(href)) return;
        prefetched.add(href);
        try {
          const response = await fetch(href, {priority:'low'});
          if (!response.ok) { prefetched.delete(href); return; }
          const template = document.createElement('template');
          template.innerHTML = await response.text();
          for (const tag of template.content.querySelectorAll('link[rel="stylesheet"][href], script[src]')) {
            const asset = new URL(tag.getAttribute('href') || tag.getAttribute('src'), href);
            if (!asset.href.startsWith(assetBase.href) || prefetched.has(asset.href)) continue;
            prefetched.add(asset.href);
            const hint = document.createElement('link');
            hint.rel = 'prefetch';
            hint.as = tag.tagName === 'LINK' ? 'style' : 'script';
            hint.href = asset.href;
            document.head.append(hint);
          }
        } catch { prefetched.delete(href); }
      }
      const warmLink = event => warm(event.target.closest('a'));
      nav.addEventListener('pointerover', warmLink);
      nav.addEventListener('focusin', warmLink);
      nav.addEventListener('pointerdown', warmLink, {passive:true});
      // HTML публичных разделов невелик. Загрузить его заранее, пока менеджер работает.
      if (publicSite) document.addEventListener('DOMContentLoaded', () => {
        for (const asset of document.querySelectorAll('link[rel="stylesheet"][href], script[src]')) {
          prefetched.add(asset.href || asset.src);
        }
        if (document.hidden || ['slow-2g', '2g'].includes(navigator.connection?.effectiveType)) return;
        // Сеть справочника может быть медленной. HTML соседнего расчёта уже можно получить.
        links.forEach(warm);
      }, {once:true});
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
