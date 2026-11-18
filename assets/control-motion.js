/* Стрелки выбирают вариант через существующий обработчик кнопки, включая новые группы в расчёте. */
(() => {
  'use strict';
  const segment = '.sm:not(.sm-pdf) .sm-conditions :is(#sm-project, #sm-type)';
  const motion = matchMedia('screen and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
  const origins = new WeakMap();

  // До штатного обработчика фиксируем видимое положение, в том числе на полпути.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button:enabled');
    const group = button?.parentElement;
    if (!group?.matches(segment)) return;
    const surface = group.querySelector('.sm-segment-surface');
    if (event.detail && button.matches('[aria-pressed="true"]')) return;
    if (event.detail && motion.matches) {
      const old = surface || group.querySelector('button[aria-pressed="true"]');
      if (old) {
        const rect = old.getBoundingClientRect(), rail = group.getBoundingClientRect();
        origins.set(event, {id:group.id, value:button.dataset.v, x:rect.left - rail.left - group.clientLeft,
          y:rect.top - rail.top - group.clientTop, width:rect.width, height:rect.height});
      }
    }
    surface?.remove();
  }, true);

  // К этому моменту калькулятор уже применил выбор и мог заменить кнопки.
  document.addEventListener('click', event => {
    const from = origins.get(event);
    if (!from) return;
    const group = document.getElementById(from.id);
    const selected = group?.querySelector('button[aria-pressed="true"]');
    if (!selected || selected.dataset.v !== from.value) return;
    const {offsetLeft:x, offsetTop:y, offsetWidth:width, offsetHeight:height} = selected;
    if (!width || !height) return;
    const surface = document.createElement('span');
    surface.className = 'sm-segment-surface';
    surface.setAttribute('aria-hidden', 'true');
    Object.assign(surface.style, {left:x+'px', top:y+'px', width:width+'px', height:height+'px'});
    if (Math.abs(from.y - y) < 3) {
      surface.style.setProperty('--sm-segment-from',
        `translateX(${from.x - x}px) scale(${from.width / width}, ${from.height / height})`);
    } else {
      surface.classList.add('sm-segment-surface--fade');
    }
    const finish = () => surface.remove();
    surface.addEventListener('animationend', finish, {once:true});
    surface.addEventListener('animationcancel', finish, {once:true});
    group.append(surface);
  });

  function settle() {
    document.querySelectorAll('.sm-segment-surface').forEach(el => el.remove());
  }
  motion.addEventListener('change', settle);
  window.addEventListener('resize', settle);
  document.addEventListener('keydown', settle, true);

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const {key} = event;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    const button = event.target.closest?.('button[aria-pressed]');
    const group = button?.parentElement;
    if (!group?.matches('.sm-pills, .tools-pills, .sm-theme-switch')) return;
    const buttons = [...group.querySelectorAll(':scope > button[aria-pressed]:enabled')]
      .filter(item => item.getClientRects().length);
    const index = buttons.indexOf(button);
    if (index < 0 || buttons.length < 2) return;
    event.preventDefault();
    let next;
    if (key === 'Home') next = buttons[0];
    else if (key === 'End') next = buttons[buttons.length - 1];
    else {
      const forward = (key === 'ArrowRight') !== (getComputedStyle(group).direction === 'rtl');
      next = buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length];
    }
    // Обработчик рассрочки сам возвращает фокус после пересоздания группы.
    next.focus();
    if (next.getAttribute('aria-pressed') !== 'true') next.click();
  });
})();
