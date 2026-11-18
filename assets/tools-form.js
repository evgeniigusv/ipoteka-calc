/* Короткая форма поверх общей схемы. В расчёты уходят прежние поля справочника. */
(function () {
  'use strict';
  const M = window.SMToolsModel;
  const esc = window.SMUi.esc;
  const mainFields = {
    mortgage: ['bank', 'type', 'kids', 'rate', 'minPv', 'term', 'limit', 'subsidy'],
    installment: ['minPv', 'scheme', 'end', 'months', 'steps', 'pay.1', 'pay.2', 'pay.3', 'disc', 'discFromPv'],
    tranche: ['bank', 'minPv', 'estimate', 'rate', 'referencePayment', 'referencePrincipal', 'referenceYears', 'tranches', 'flexibleTranches', 'firstRub', 'first', 'second', 'date2', 'secondMonths', 'date3', 'lastMonthsBeforeCommissioning', 'maxDate'],
    chpv: ['limit', 'years', 'rate', 'minDown', 'cost', 'overRate'],
    discount: ['percent'], info: []
  };

  function control(form, name) { return form.elements.namedItem(name); }
  function label(form, name) { return control(form, name)?.closest('.tools-field'); }
  function value(form, name) { return control(form, name)?.value || ''; }
  function select(name, title, options, selected) {
    const container = document.createElement('label');
    container.className = 'tools-field';
    container.innerHTML = '<span class="tools-field-title">' + esc(title) + '</span><select name="' + name + '">' +
      options.map(([key, text]) => '<option value="' + key + '"' + (key === selected ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select>';
    return container;
  }
  function hint(form, name, text) {
    const input = control(form, name);
    const small = document.createElement('small');
    small.id = 'hint-' + name.replace(/[^a-z0-9]/gi, '-');
    small.textContent = text;
    label(form, name).append(small);
    input.setAttribute('aria-describedby', small.id);
  }
  function show(form, name, visible, required = false) {
    const input = control(form, name);
    if (!input) return;
    label(form, name).hidden = !visible;
    input.required = visible && required;
  }
  function number(text, title) {
    const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(title + ' — введите число.');
    return Number(cleaned);
  }
  function reveal(input) {
    let parent = input.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  }
  function suggestedName(form, record) {
    switch (record.kind) {
      case 'mortgage': return [value(form, 'p:type'), value(form, 'p:bank'), value(form, 'p:kids')].filter(Boolean).join(' · ');
      case 'installment': return 'Рассрочка' + (value(form, 'p:minPv') ? ' от ' + value(form, 'p:minPv') + '%' : '');
      case 'tranche': return 'Траншевая ипотека' + (value(form, 'p:bank') ? ' · ' + value(form, 'p:bank') : '');
      case 'chpv': return 'Дофинансирование ПВ' + (value(form, 'p:rate') ? ' · ' + value(form, 'p:rate') + '%' : '');
      case 'discount': return 'Скидка за полную оплату';
      default: return '';
    }
  }

  function mount(form, record, records) {
    const host = document.getElementById('tools-editor-fields');
    const p = record.params;
    const core = document.createElement('div');
    core.className = 'tools-form-core tools-param-grid';
    const more = document.createElement('details');
    more.className = 'tools-form-more';
    more.innerHTML = '<summary>Дополнительно</summary><div class="tools-param-grid"></div>';
    const extra = more.lastElementChild;
    const help = document.createElement('p');
    help.className = 'tools-form-help';
    help.textContent = '* Обязательно. Остальное — по необходимости.';
    host.prepend(help, core);
    host.append(more);
    for (const name of ['project', 'category', 'name']) core.append(label(form, name));
    for (const key of mainFields[record.kind] || []) core.append(label(form, 'p:' + key));
    for (const field of [...host.children].filter(node => node.classList.contains('tools-field'))) {
      if (!core.contains(field)) extra.append(field);
    }
    for (const note of [...host.querySelectorAll('.tools-ownership-note')]) core.prepend(note);
    const titles = {
      'p:months': 'Срок, месяцев', 'p:end': 'Дата погашения',
      'p:firstRub': 'Первый транш, ₽', 'p:second': 'Второй транш, % цены',
      'p:secondMonths': 'Месяцев от сделки до второго транша',
      'p:lastMonthsBeforeCommissioning': 'За сколько месяцев до ввода',
      'p:disc': 'Скидка в процентах',
      'p:referencePrincipal': 'Сумма кредита для ориентира, ₽',
      'p:referenceYears': 'Срок кредита для ориентира, лет'
    };
    for (const [name, title] of Object.entries(titles)) {
      const caption = label(form, name)?.querySelector('.tools-field-title');
      if (caption) caption.textContent = title;
    }
    const nameInput = control(form, 'name');
    nameInput.required = record.kind === 'info';
    nameInput.maxLength = 200;
    if (record.kind !== 'info') hint(form, 'name', 'Можно оставить пустым — название появится автоматически.');
    if (record.kind === 'info') {
      core.append(label(form, 'description'));
      control(form, 'description').required = true;
      control(form, 'description').placeholder = record.category==='discount'?'Кому доступна акция и на каких условиях':'Например, бронь на 7 дней, стоимость 10 000 ₽';
      if(record.category==='discount')core.append(label(form,'p:percent'));else label(form,'p:percent').hidden=true;
    } else {
      control(form, 'description').placeholder = 'Особые условия или пояснение для партнёров';
    }
    hint(form, 'validUntil', 'Последний день оформления новой сделки по этим условиям.');
    if (control(form, 'visibility')) core.append(label(form, 'visibility'));
    for (const field of M.fields[record.kind] || []) {
      const input = control(form, 'p:' + field.key);
      if (['percent', 'money', 'integer'].includes(field.type)) {
        input.inputMode = field.type === 'percent' ? 'decimal' : 'numeric';
        if (field.type === 'percent') input.placeholder = 'Например, 20,1';
      }
    }

    if (record.project && record.category && !control(form, 'project').disabled) {
      const context = document.createElement('details');
      context.className = 'tools-form-context';
      context.innerHTML = '<summary>' + esc(M.projects[record.project]) + ' · ' + esc(M.categories[M.section(record)]) + ' <span>Изменить</span></summary><div class="tools-param-grid"></div>';
      core.prepend(context);
      context.lastElementChild.append(label(form, 'project'), label(form, 'category'));
    }

    if (record.kind === 'mortgage') {
      for (const key of ['bank', 'type', 'rate', 'minPv', 'term', 'subsidy']) control(form, 'p:' + key).required = true;
      hint(form, 'p:limit', 'Для семейной ипотеки обязателен. Для остальных — если есть ограничение.');
    }
    if (record.kind === 'chpv') {
      for (const key of mainFields.chpv) control(form, 'p:' + key).required = true;
    }
    if (record.kind === 'discount') control(form, 'p:percent').required = true;

    if (record.kind === 'installment') {
      control(form, 'p:minPv').required = control(form, 'p:scheme').required = true;
      label(form, 'p:end').before(select('ui:end', 'Срок погашения', [['date', 'До даты'], ['months', 'Месяцев от сделки']], p.end ? 'date' : 'months'));
      const payments = select('ui:pay', 'Ежемесячный платёж', [['same', 'Одинаковый для всех квартир'], ['different', 'Зависит от числа комнат']], p.pay && new Set(Object.values(p.pay)).size > 1 ? 'different' : 'same');
      label(form, 'p:pay.1').before(payments);
      const shared = document.createElement('label');
      shared.className = 'tools-field';
      shared.innerHTML = '<span class="tools-field-title">Платёж в месяц, ₽</span><input name="ui:payment" inputmode="numeric" value="' + esc(p.pay?.[1] ?? '') + '">';
      payments.after(shared);
      const discount = document.createElement('label');
      discount.className = 'tools-field';
      discount.innerHTML = '<span class="tools-field-title">Скидка в процентах</span><input name="ui:discountPercent" inputmode="decimal" value="'+esc(+((p.discFromPv||p.disc||0)*100).toFixed(6))+'">';
      const fromPv = document.createElement('label');
      fromPv.className = 'tools-field tools-check-field';
      fromPv.innerHTML = '<span class="tools-field-title">База скидки</span><span><input type="checkbox" name="ui:discountFromPv"'+(p.discFromPv?' checked':'')+'> Скидка на сумму ПВ</span>';
      label(form,'p:disc').before(discount,fromPv);
      hint(form,'ui:discountFromPv','Без галочки скидка применяется ко всей цене квартиры.');
      for(const key of ['disc','discFromPv','maxDisc','launchDiscount','launchUntil','pvChoices','discAt70'])label(form,'p:'+key).hidden=true;
      const highDown = document.createElement('p');
      highDown.className='tools-form-help wide';
      highDown.textContent='При взносе от 71% действует актуальная скидка за полную оплату.';
      core.append(highDown);
      const stages = document.getElementById('tools-milestones').closest('.tools-field');
      const stagePanel = document.createElement('details');
      stagePanel.className = 'tools-stages-panel';
      stagePanel.innerHTML = '<summary>Промежуточные платежи</summary>';
      core.append(stagePanel);
      stagePanel.append(stages);
      stagePanel.open = Boolean(p.milestones?.length) || p.scheme === 'scheduled';
      stages.classList.add('tools-stages-field');
      const stepInput = control(form, 'p:steps');
      const periods = document.createElement('div');
      periods.className = 'tools-field wide';
      periods.innerHTML = '<span class="tools-field-title">Периодичность платежей *</span><details class="tools-period-picker"><summary>Выберите периодичность</summary><div class="tools-periods"></div></details><small>Можно разрешить несколько вариантов на выбор клиента.</small>';
      const choices = periods.querySelector('.tools-periods');
      for (const [step, text] of [[1, 'Каждый месяц'], [2, 'Раз в 2 месяца'], [3, 'Раз в квартал'], [6, 'Раз в полгода'], [12, 'Раз в год']]) {
        const option = document.createElement('label');
        option.innerHTML = '<input type="checkbox" data-period="' + step + '"' + (p.steps?.includes(step) ? ' checked' : '') + '> ' + text;
        choices.append(option);
      }
      const oldLabel = label(form, 'p:steps');
      stepInput.type = 'hidden';
      periods.append(stepInput);
      oldLabel.replaceWith(periods);
      function periodTitle(){
        const selected=[...choices.querySelectorAll(':checked')].map(input=>input.parentElement.textContent.trim());
        periods.querySelector('summary').textContent=selected.join(', ')||'Выберите периодичность';
      }
      periodTitle();
      choices.addEventListener('change', () => {
        stepInput.value = [...choices.querySelectorAll(':checked')].map(input => input.dataset.period).join(', ');
        periodTitle();
      });
    }

    if (record.kind === 'tranche') {
      control(form, 'p:minPv').required = true;
      const estimate = label(form, 'p:estimate');
      estimate.before(select('ui:rate', 'Расчёт платежа', [['rate', 'По ставке банка'], ['estimate', 'По ориентиру платежа']], p.estimate ? 'estimate' : 'rate'));
      estimate.hidden = true;
      const tranches = control(form, 'p:tranches');
      tranches.options[0].textContent = 'По согласованию';
      for (const option of tranches.options) {
        if (option.value === '2') option.textContent = 'Два транша';
        if (option.value === '3') option.textContent = 'Три транша';
      }
      label(form, 'p:tranches').before(select('ui:schedule', 'График выдачи', [['fixed', 'По заданным срокам'], ['flexible', 'По согласованию с банком']], p.flexibleTranches ? 'flexible' : 'fixed'));
      label(form, 'p:flexibleTranches').hidden = true;
      label(form, 'p:firstRub').before(select('ui:first', 'Первый транш', [['rub', 'Фиксированная сумма, ₽'], ['share', 'Доля цены квартиры, %']], p.firstRub ? 'rub' : 'share'));
      const secondModes = [['date', 'В дату'], ['months', 'Через несколько месяцев'], ['before', 'До ввода дома']];
      label(form, 'p:date2').before(select('ui:second', 'Когда второй транш', secondModes, p.date2 ? 'date' : p.secondMonths ? 'months' : 'before'));
      label(form, 'p:date3').before(select('ui:last', 'Когда третий транш', [['date', 'В дату'], ['before', 'До ввода дома']], p.date3 ? 'date' : 'before'));
      const remainder = document.createElement('p');
      remainder.className = 'tools-form-help wide';
      remainder.textContent = 'Последний транш — остаток кредита. Его сумму калькулятор посчитает сам.';
      core.append(remainder);
    }

    const combinations=document.createElement('details');
    combinations.className='tools-combinations-panel';
    combinations.innerHTML='<summary>Сочетание с акциями</summary><div class="tools-promotion-list"></div>';
    extra.prepend(combinations);
    if(record.combination&&Array.isArray(p.compatiblePromotions)){
      const previous=document.createElement('p');previous.className='tools-form-help';
      previous.textContent='Прежние условия: '+record.combination+' Выберите применимые акции ниже.';
      combinations.querySelector('.tools-promotion-list').before(previous);
    }
    label(form,'combination').hidden=true;
    const mode=control(form,'mode');
    mode.replaceChildren(new Option('Суммирование','additive'),new Option('Последовательно','sequential'));
    mode.value=record.mode==='sequential'?'sequential':'additive';
    combinations.append(label(form,'mode'));
    const selectedPromotions=new Set(p.compatiblePromotions||[]);
    function promotionList(){
      const project=value(form,'project');
      const list=combinations.querySelector('.tools-promotion-list');
      list.replaceChildren();
      const available=records.filter(item=>item.category==='discount'&&item.enabled&&item.id!==record.id&&item.project===project&&((control(form,'visibility')?value(form,'visibility')==='private':p.ownerOnly)||!item.params.ownerOnly));
      for(const item of available){
        const option=document.createElement('label');
        const input=document.createElement('input');input.type='checkbox';input.dataset.promotion=item.id;input.checked=selectedPromotions.has(item.id);
        input.onchange=()=>{if(input.checked)selectedPromotions.add(item.id);else selectedPromotions.delete(item.id);};
        const text=document.createElement('span');text.textContent=item.name;
        option.append(input,text);list.append(option);
      }
      if(!available.length){const note=document.createElement('p');note.textContent='Для этого проекта пока нет акций. Добавьте их в раздел «Скидки и акции».';list.append(note);}
    }
    promotionList();
    function refresh(event) {
      if(['project','visibility'].includes(event?.target.name))promotionList();
      if (event?.target.name === 'ui:pay' && value(form, 'ui:pay') === 'different') {
        for (const key of ['pay.1', 'pay.2', 'pay.3']) {
          const input = control(form, 'p:' + key);
          if (!input.value) input.value = value(form, 'ui:payment');
        }
      }
      nameInput.placeholder = suggestedName(form, record) || 'Название инструмента';
      const context = host.querySelector('.tools-form-context summary');
      if (context) context.innerHTML = esc(M.projects[value(form, 'project')] || 'Выберите проект') + ' · ' + esc(M.categories[value(form, 'category')] || 'Выберите раздел') + ' <span>Изменить</span>';
      if (record.kind === 'mortgage') {
        const family = value(form, 'p:type') === 'Семейная ипотека';
        show(form, 'p:kids', family, family);
        control(form, 'p:limit').required = family;
      }
      if (record.kind === 'installment') {
        const scheme = value(form, 'p:scheme');
        const monthly = scheme === 'monthly';
        const different = value(form, 'ui:pay') === 'different';
        show(form, 'p:end', value(form, 'ui:end') === 'date', true);
        show(form, 'p:months', value(form, 'ui:end') === 'months', true);
        show(form, 'p:steps', scheme === 'equal');
        const periods = host.querySelectorAll('[data-period]');
        periods[0].required = scheme === 'equal' && ![...periods].some(input => input.checked);
        show(form, 'ui:pay', monthly);
        show(form, 'ui:payment', monthly && !different, true);
        for (const key of ['pay.1', 'pay.2', 'pay.3']) show(form, 'p:' + key, monthly && different, true);
        show(form, 'p:pvFromBase', !control(form,'ui:discountFromPv').checked);
        const stagePanel=host.querySelector('.tools-stages-panel');
        stagePanel.hidden=scheme!=='scheduled'&&scheme!=='monthly';
        if(scheme==='scheduled')stagePanel.open=true;
        for(const row of stagePanel.querySelectorAll('.tools-milestone')){
          const amountMode=row.querySelector('[data-stage="amountMode"]').value;
          const dateMode=row.querySelector('[data-stage="mode"]').value;
          for(const input of row.querySelectorAll('input'))input.required=!stagePanel.hidden&&[amountMode,dateMode].includes(input.dataset.stage);
        }
      }
      if (record.kind === 'tranche') {
        const estimate = value(form, 'ui:rate') === 'estimate';
        const flexible = value(form, 'ui:schedule') === 'flexible';
        const three = value(form, 'p:tranches') === '3' && !flexible;
        const existingWithoutRate = record.name && record.params.rate == null && !record.params.estimate &&
          (record.params.flexibleTranches || (+record.params.tranches === 2 && record.params.firstRub));
        show(form, 'p:rate', !estimate, !estimate && !existingWithoutRate);
        for (const key of ['referencePayment', 'referencePrincipal', 'referenceYears']) show(form, 'p:' + key, estimate, true);
        show(form, 'p:tranches', !flexible, true);
        show(form, 'ui:first', !three && !flexible);
        show(form, 'p:firstRub', flexible || (!three && value(form, 'ui:first') === 'rub'), !flexible);
        show(form, 'p:first', three || (!flexible && value(form, 'ui:first') === 'share'), true);
        show(form, 'p:second', three, true);
        const second = control(form, 'ui:second');
        second.querySelector('[value="before"]').disabled = three;
        if (three && second.value === 'before') second.value = 'months';
        show(form, 'ui:second', !flexible);
        show(form, 'p:date2', !flexible && second.value === 'date', true);
        show(form, 'p:secondMonths', !flexible && second.value === 'months', true);
        show(form, 'ui:last', three);
        show(form, 'p:date3', three && value(form, 'ui:last') === 'date', true);
        show(form, 'p:lastMonthsBeforeCommissioning', !flexible && (three ? value(form, 'ui:last') === 'before' : second.value === 'before'), true);
        show(form, 'p:maxDate', flexible, true);
      }
      const launch = control(form, 'p:launchDiscount');
      if (launch && record.kind!=='installment') control(form, 'p:launchUntil').required = Number(launch.value.replace(',', '.')) > 0;
    }
    form.oninput = refresh;
    form.onchange = refresh;
    refresh();
  }

  function readParams(form, record) {
    const params = M.clone(record.params);
    for (const field of M.fields[record.kind] || []) {
      const input = control(form, 'p:' + field.key);
      if (input.closest('.tools-field').hidden) continue;
      let text = input.value.trim();
      let parsed;
      if (field.type === 'boolean') {
        if (!input.checked && M.get(params, field.key) == null) continue;
        parsed = input.checked;
      } else if (text === '') {
        const parts = field.key.split('.');
        if (parts.length === 2) { if (params[parts[0]]) delete params[parts[0]][parts[1]]; }
        else delete params[field.key];
        continue;
      } else {
        try {
          if (['percent', 'integer', 'money'].includes(field.type)) {
            parsed = number(text, field.label);
            if (field.type === 'percent') {
              const before = M.get(record.params, field.key);
              parsed = before != null && parsed === +(before * 100).toFixed(6) ? before : parsed / 100;
            }
          } else if (['steps', 'percentList'].includes(field.type)) {
            parsed = text.split(field.type === 'steps' ? /[,;]+/ : /;/).map(part => number(part, field.label) / (field.type === 'percentList' ? 100 : 1));
          } else {
            const original = M.get(record.params, field.key);
            parsed = String(original) === text ? original : text;
          }
        } catch (error) {
          reveal(input);
          input.focus();
          throw error;
        }
      }
      M.set(params, field.key, parsed);
    }
    if (params.pay && !Object.keys(params.pay).length) delete params.pay;
    if (record.kind === 'installment') {
      delete params[value(form, 'ui:end') === 'date' ? 'months' : 'end'];
      if (params.scheme === 'monthly' && value(form, 'ui:pay') === 'same') {
        const payment = value(form, 'ui:payment');
        if (payment) {
          const amount = number(payment, 'Платёж в месяц');
          params.pay = {1: amount, 2: amount, 3: amount};
        } else delete params.pay;
      }
      const discountText=value(form,'ui:discountPercent');
      const discount=discountText?number(discountText,'Скидка в процентах')/100:0;
      delete params.disc;
      delete params.discFromPv;
      if(control(form,'ui:discountFromPv').checked){params.discFromPv=discount;params.pvFromBase=true;}
      else params.disc=discount;
      for(const key of ['maxDisc','launchDiscount','launchUntil','pvChoices','discAt70'])delete params[key];
      if(params.scheme!=='equal')delete params.steps;
      if(params.scheme!=='monthly')delete params.pay;
      if(['scheduled','monthly'].includes(params.scheme)){
        params.milestones=[...document.getElementById('tools-milestones').children].map(row=>{
          const stage={};
          const amountMode=row.querySelector('[data-stage="amountMode"]').value;
          const amountInput=row.querySelector('[data-stage="'+amountMode+'"]');
          stage[amountMode]=number(amountInput.value,amountMode==='amount'?'Сумма этапа':'Доля этапа')/(amountMode==='share'?100:1);
          const mode=row.querySelector('[data-stage="mode"]').value;
          const input=row.querySelector('[data-stage="'+mode+'"]');
          stage[mode]=mode==='months'?number(input.value,'Месяцев до этапа'):input.value;
          const original=row.dataset.originalDate;
          if(mode==='date'&&original?.length===7&&stage.date===original+'-01')stage.date=original;
          return stage;
        });
        if(!params.milestones.length)delete params.milestones;
      }else delete params.milestones;
      delete params.noExtra;
      delete params.extraSequential;
    }
    if (record.kind === 'tranche') {
      const estimate = value(form, 'ui:rate') === 'estimate';
      if (estimate || 'estimate' in params) params.estimate = estimate;
      const flexible = value(form, 'ui:schedule') === 'flexible';
      if (flexible || 'flexibleTranches' in params) params.flexibleTranches = flexible;
      const three = +params.tranches === 3 && !flexible;
      if (!flexible && (three || value(form, 'ui:first') === 'share')) delete params.firstRub;
      else delete params.first;
      if (flexible) {
        if (+params.tranches === 3) params.tranches = '2';
        for (const key of ['first', 'second', 'date2', 'secondMonths', 'date3', 'lastMonthsBeforeCommissioning']) delete params[key];
      } else {
        delete params.maxDate;
        const second = value(form, 'ui:second');
        if (second !== 'date') delete params.date2;
        if (second !== 'months') delete params.secondMonths;
        if (!three) {
          delete params.second;
          delete params.date3;
          if (second !== 'before') delete params.lastMonthsBeforeCommissioning;
        } else if (value(form, 'ui:last') === 'date') delete params.lastMonthsBeforeCommissioning;
        else delete params.date3;
      }
    }
    params.compatiblePromotions=[...form.querySelectorAll('[data-promotion]:checked')].map(input=>input.dataset.promotion);
    if (value(form, 'validUntil')) params.validUntil = value(form, 'validUntil');
    else delete params.validUntil;
    if (control(form, 'visibility')) {
      if (value(form, 'visibility') === 'private') params.ownerOnly = true;
      else delete params.ownerOnly;
    }
    return params;
  }
  document.getElementById('tools-form').addEventListener('invalid', event => reveal(event.target), true);
  window.SMToolsForm = {mount, readParams, suggestedName};
})();
