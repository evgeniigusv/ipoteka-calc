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
