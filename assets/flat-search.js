/* Редактируемый поиск квартиры. Фокус и текст всегда принадлежат исходному полю. */
(function (root) {
  'use strict';
  function setup(input, { choices, rowContent, selectedValue = () => '', emptyMessage, choose }) {
    const field = input.parentElement;
    field.classList.add('sm-flat-search');
    const popup = document.createElement('div');
    popup.className = 'sm-flat-search__popup';
    popup.hidden = true;
    const list = document.createElement('div');
    list.id = input.id + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Подсказки по номеру квартиры');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    popup.append(list, status);
    input.after(popup);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    let active = -1, expanded = false, transition = 0;

    let rendered = [];
    function highlight(index) {
      const previous = list.children[active], next = list.children[index];
      if (previous) previous.setAttribute('aria-selected', 'false');
      active = next ? index : -1;
      if (!next) {
        input.removeAttribute('aria-activedescendant');
        return;
      }
      next.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', next.id);
      // Прокручиваем только подсказки: страница и экранная клавиатура остаются на месте.
      const box = popup.getBoundingClientRect(), option = next.getBoundingClientRect();
      if (option.bottom > box.bottom) popup.scrollTop += option.bottom - box.bottom + 4;
      else if (option.top < box.top) popup.scrollTop += option.top - box.top - 4;
    }
    function position() {
      if (!expanded) return;
      const viewport = root.visualViewport;
      const top = viewport?.offsetTop || 0;
      const rect = field.getBoundingClientRect();
      const below = top + (viewport?.height || root.innerHeight) - rect.bottom - 8;
      const above = rect.top - top - 8;
      // У границы экранной клавиатуры небольшое изменение высоты не переворачивает открытый список.
      const margin = popup.hasAttribute('data-open') ? 20 : 0;
      const bias = popup.classList.contains('sm-flat-search__popup--above') ? margin : -margin;
      const flip = below < 180 + bias && above + bias > below;
      popup.classList.toggle('sm-flat-search__popup--above', flip);
      popup.style.setProperty('--sm-flat-space', Math.max(0, flip ? above : below) + 'px');
    }
    function markCurrent(current) {
      const previous = list.querySelector('[aria-current]');
      if (previous) previous.removeAttribute('aria-current');
      const selected = current && document.getElementById(list.id + '-' + current);
      if (selected) selected.setAttribute('aria-current', 'true');
    }
    function refresh() {
      if (!expanded) return;
      highlight(-1);
      const items = choices();
      const current = selectedValue();
      if (items.length !== rendered.length || items.some((item, i) => item !== rendered[i])) {
        list.replaceChildren(...items.map(item => {
          const option = document.createElement('div');
          option.className = 'sm-flat-search__option';
          option.setAttribute('role', 'option');
          option.setAttribute('aria-label', item.label);
          option.setAttribute('aria-selected', 'false');
          option.id = list.id + '-' + item.value;
          option.dataset.value = item.value;
          if (rowContent) option.append(rowContent(item));
          else option.textContent = item.label;
          return option;
        }));
        rendered = items;
      }
      markCurrent(current);
      status.className = items.length ? 'sm-flat-search__sr' : 'sm-flat-search__message';
      status.textContent = items.length ? 'Найдено квартир: ' + items.length : emptyMessage();
      popup.scrollTop = 0;
      position();
    }
    function open() {
      if (expanded) return;
      expanded = true;
      transition++;
      popup.hidden = false;
      popup.inert = false;
      popup.removeAttribute('aria-hidden');
      input.setAttribute('aria-expanded', 'true');
      refresh(); // Измерение позиции фиксирует начальную прозрачность.
      popup.dataset.open = '';
    }
    function close(immediate = false) {
      if (!expanded && !immediate) return;
      expanded = false;
      const closing = ++transition;
      input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-expanded', 'false');
      popup.inert = true;
      popup.setAttribute('aria-hidden', 'true');
      delete popup.dataset.open;
      const animations = immediate ? [] : popup.getAnimations();
      if (!animations.length) { popup.hidden = true; return; }
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (transition === closing) popup.hidden = true;
      });
    }
    function commit(option) {
      if (list.children[active] !== option) highlight(-1);
      markCurrent(option.dataset.value);
      close();
      choose(option.dataset.value);
    }
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    function opensOtherPicker(target) {
      return !!target?.closest('select, [role="combobox"], label[for="sm-flat"]') && target !== input;
    }
    input.addEventListener('blur', event => close(opensOtherPicker(event.relatedTarget)));
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'Escape' && expanded) {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (event.altKey && event.key === 'ArrowUp') { close(); return; }
        open();
        if (event.altKey) return;
        const last = list.children.length - 1;
        const next = event.key === 'ArrowDown' ? Math.min(last, active + 1) : active < 0 ? last : Math.max(0, active - 1);
        highlight(next);
      } else if (event.key === 'Enter' && expanded) {
        if (active >= 0) { event.preventDefault(); commit(list.children[active]); }
        else close();
      } else if (expanded) {
        // Home, End и стрелки влево/вправо сохраняют обычное редактирование текста.
        highlight(-1);
      }
    });
    popup.addEventListener('mousedown', event => event.preventDefault());
    popup.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) commit(option);
    });
    document.addEventListener('pointerdown', event => {
      if (!popup.hidden && event.target !== input && !popup.contains(event.target)) close(opensOtherPicker(event.target));
    }, true);
    root.addEventListener('resize', position);
    root.addEventListener('scroll', position, {passive:true});
    root.visualViewport?.addEventListener('resize', position);
    root.visualViewport?.addEventListener('scroll', position);
    if (document.activeElement === input) open();
    return { open, close, refresh };
  }
  root.SMFlatSearch = { setup };
})(window);
