/* Выбор акций из разрешённого для программы списка. */
(function () {
  'use strict';
  function setup(anchor, onChange) {
    const field = document.createElement('fieldset');
    field.className = 'sm-promotion-picker';
    const legend = document.createElement('legend');
    legend.textContent = 'Совместимые акции';
    field.append(legend);
    anchor.after(field);
    let selected = new Set(), current = [], signature = '';
    function refresh(program, project) {
      current = window.SMCalc.compatiblePromotions({promotions: window.SM_DATA.promotions || []}, program || {}, project);
      const next = JSON.stringify(current.map(item => [item.id, item.name, item.percent]));
      selected = new Set([...selected].filter(id => current.some(item => item.id === id)));
      field.hidden = !current.length;
      if (next === signature) return;
      signature = next;
      field.replaceChildren(legend);
      for (const item of current) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selected.has(item.id);
        input.onchange = () => {
          if (input.checked) selected.add(item.id); else selected.delete(item.id);
          onChange();
        };
        const title = document.createElement('span');
        title.textContent = item.name + (item.percent == null ? ' · условия акции' : ' · ' + window.SMCalc.fmt.pct(item.percent));
        label.append(input, title);
        field.append(label);
      }
    }
    return {
      refresh,
      ids: () => [...selected],
      names: () => current.filter(item => selected.has(item.id)).map(item => item.name)
    };
  }
  window.SMPromotionPicker = {setup};
})();
