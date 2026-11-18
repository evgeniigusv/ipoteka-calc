/* Расчёты калькуляторов «Свобода мысли»: ипотека и рассрочка.
   К странице не обращается — те же функции проверяются тестами (tests/engine.test.mjs).

   Комиссия ипотеки считается от окончательного кредита (ДДУ − ПВ).
   ДДУ = акционная цена + max(0, комиссия − лимит компенсации компании).
   Взаимозависимость ДДУ и кредита решается аналитически, без итераций. */
(function (root) {
  'use strict';

  /* ================== ДАТЫ ================== */
  function toDate(v) { // «2028-07-05»
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v == null ? '' : String(v));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addMonths(d, m) { // день не выходит за конец месяца
    var y = d.getFullYear(), mo = d.getMonth() + m, last = new Date(y, mo + 1, 0).getDate();
    return new Date(y, mo, Math.min(d.getDate(), last));
  }
  function monthsBetween(a, b) { // полных месяцев от a до b
    var m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (addMonths(a, m) > b) m--;
    return Math.max(m, 0);
  }

  /* ================== ФОРМАТ ================== */
  var nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  function clean(x) { return +x.toPrecision(12); }
  function rub(v) { return nf0.format(Math.round(v)) + ' ₽'; }
  function pct(v) { return nf2.format(clean(v * 100)) + '%'; }
  function pct1(v) { return nf1.format(clean(v * 100)) + '%'; }
  function pct0(v) { return nf0.format(Math.round(clean(v * 100))) + '%'; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many);
  }
  function years(y) { return nf1.format(y) + ' ' + (Number.isInteger(y) ? plural(y, 'год', 'года', 'лет') : 'года'); }
  function months(m) { return m + ' ' + plural(m, 'месяц', 'месяца', 'месяцев'); }
  function period(m) { return m % 12 === 0 ? years(m / 12) : months(m); }
  function dmy(d) { return d ? d.toLocaleDateString('ru-RU') : '—'; }

  /* ================== ДАННЫЕ (assets/data.js) ================== */
  function uniq(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }
  function or(v, dflt) { return v == null ? dflt : v; }
  var PROJECT_KEYS = { 'ДА — 1 очередь': 'da1', 'ДА — 2 очередь': 'da2', 'ДНК — 2 очередь': 'dnk2' };
  function forProject(item, project) { return !item.projects || !item.projects.length || item.projects.indexOf(project) >= 0 || item.projects.indexOf(PROJECT_KEYS[project]) >= 0; }

  function cashDiscount(D, project, today) {
    var p = D.cashDiscounts[project] || D.cashDiscounts[PROJECT_KEYS[project]];
    // Пустой актуальный каталог означает отсутствие активной скидки, а не сбой загрузки.
    if (!p) return D.cashDiscountCatalogPresent ? 0 : D.defaultDiscount;
    var launch = toDate(p.launchUntil);
    return (p.percent || 0) + (launch && startOfDay(today || new Date()) <= launch ? (p.launchDiscount || 0) : 0);
  }
  function compensationLimit(D, project) {
    var limits = D.settings.subsidyCompensation || {};
    var value=limits[PROJECT_KEYS[project] || project];
    return Number.isFinite(value) && value>=0 ? value : null;
  }
  // Явный список совместимости имеет приоритет над прежними режимами noExtra.
  function compatiblePromotions(D, p, project) {
    return D.promotions.filter(function (a) {
      return a.scope !== 'cash' && forProject(a, project) && (a.percent == null || (Number.isFinite(a.percent) && a.percent >= 0 && a.percent < 1)) &&
        (Array.isArray(p.compatiblePromotions) ? p.compatiblePromotions.indexOf(a.id) >= 0 : !p.noExtra && p.combinationMode !== 'none' && p.combinationMode !== 'individual');
    });
  }
  function selectedPromotions(D, p, inp) {
    return compatiblePromotions(D, p, inp.project).filter(function (a) { return (inp.promotionIds || []).indexOf(a.id) >= 0; });
  }
  function combinedDiscount(discounts, sequential) {
    return sequential ? 1 - discounts.reduce(function (price, d) { return price * (1 - d); }, 1)
      : discounts.reduce(function (sum, d) { return sum + d; }, 0);
  }
  function promotionRates(promotions, project, program, selectedIds) {
    return selectedPromotions({promotions:promotions || []},program,{project:project,promotionIds:selectedIds || []})
      .filter(function(a){return Number.isFinite(a.percent);}).map(function(a){return a.percent;});
  }
  function discountedPrice(base, baseDiscount, rates, mode) {
    return Math.round(base*(1-combinedDiscount([baseDiscount || 0].concat(rates || []),mode==='sequential')));
  }

  function buildData(raw) {
    var programs = (raw.mortgage || []).map(function (p, i) {
      // Лимит кредита — из строки, а для семейной ипотеки — по числу детей
      var limit = or(p.limit, p.kids && raw.limitsByKids ? or(raw.limitsByKids[p.kids], Infinity) : Infinity);
      return {
        id: i + 1, projects: p.projects || raw.mortgageProjects || [], type: p.type,
        name: p.name || p.bank + (p.variant ? ', ' + p.variant : ''),
        r1: p.rate, r2: or(p.rateAfter, p.rate), grace: p.graceYears || 0,
        minTerm: p.minTerm || 1, maxTerm: p.term || 30,
        minPv: or(p.minPv, raw.minPv || 0), maxPv: or(p.maxPv, 1),
        minLoan: p.minLoan || 0, limit: limit,
        sub: p.subsidy || 0, minPrice: or(p.minPrice, null), kids: p.kids || null,
        catalogId: p.catalogId, compatiblePromotions: p.compatiblePromotions, combinationMode: p.combinationMode,
        extraSequential: p.combinationMode ? p.combinationMode === 'sequential' : !!p.extraSequential, noExtra: !!p.noExtra
      };
    });
    var inst = (raw.installments || []).map(function (p, i) {
      return {
        id: i + 1, projects: p.projects || [], name: p.name, kind: p.scheme,
        minPv: p.minPv || 0, pay: p.pay || {}, end: toDate(p.end), months: p.months || 0,
        disc: p.disc || 0, discFromPv: p.discFromPv || 0,
        steps: p.steps && p.steps.some(function(s){return [1,2,3,6,12].indexOf(s)>=0;}) ? uniq(p.steps.filter(function(s){return [1,2,3,6,12].indexOf(s)>=0;})).sort(function(a,b){return a-b;}) : [1], note: p.note || '',
        pvFromBase: !!p.pvFromBase, extraSequential: p.combinationMode ? p.combinationMode === 'sequential' : !!p.extraSequential, validUntil: toDate(p.validUntil),
        milestones: p.milestones || [], noExtra: !!p.noExtra,
        catalogId: p.catalogId, compatiblePromotions: p.compatiblePromotions, combinationMode: p.combinationMode
      };
    });
    return {
      programs: programs, installments: inst,
      projects: raw.projects || [],
      types: raw.types || uniq(programs.map(function (p) { return p.type; })),
      defaultDiscount: raw.defaultDiscount || 0, cashDiscounts: raw.cashDiscounts || {},
      cashDiscountCatalogPresent: raw.cashDiscounts != null,
      settings: raw.settings || {}, promotions: raw.promotions || []
    };
  }

  // Варианты «Количество детей» — только если у программ этого типа они заданы
  function kidsOptions(D, project, type) {
    var list = uniq(D.programs.filter(function (p) { return p.kids && p.type === type && forProject(p, project); })
      .map(function (p) { return p.kids; }));
    return list.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); }); // «1 ребёнок», «2 ребёнка»…
  }

  /* ================== ИПОТЕКА ================== */
  function pmt(rate, n, loan) { // аннуитет, как PMT в таблице
    if (n <= 0 || loan <= 0) return 0;
    return rate === 0 ? loan / n : loan * rate / (1 - Math.pow(1 + rate, -n));
  }
  function balanceAfter(rate, k, pay, loan) { // остаток долга после k платежей
    if (rate === 0) return loan - pay * k;
    var f = Math.pow(1 + rate, k);
    return loan * f - pay * (f - 1) / rate;
  }

  var OK = 'Подходит';

  // opts сохранён для совместимости вызовов; кредит всегда равен ДДУ − ПВ.
  function calcProgram(p, inp, opts) {
    var B = inp.base, D = inp.cash > 0 ? Math.round(inp.cash) : Math.round(B * (1 - inp.disc)), pvIn = Math.round(inp.pv || 0);
    var s = p.sub, m = p.minPv, lim = p.limit;

    var cap = inp.companyPays === true ? D * Math.max(0, inp.compensationLimit || 0) : 0;
    // При кредите ровно lim цена = D + max(0, s*lim − cap). Отсюда минимальный ПВ.
    var limitDown = Number.isFinite(lim) ? D + Math.max(0, s * lim - cap) - lim : 0;
    var minPvRub = Math.max(Math.ceil(m * B - 1e-6), Math.ceil(limitDown - 1e-6), 0);
    var pv = Math.min(Math.max(pvIn, minPvRub), D);
    var validSubsidy = Number.isFinite(s) && s >= 0 && s < 1;
    var price = validSubsidy ? Math.round(D + Math.max(0, (s * (D - pv) - cap) / (1 - s))) : D;
    var loan = Math.max(price - pv, 0);
    var subsidy = validSubsidy ? loan * s : 0;
    var companyCompensation = Math.min(subsidy, cap);
    var clientSubsidy = subsidy - companyCompensation;
    var surplus = B - price;
    var pvShare = B > 0 ? pv / B : 0;
    var byLimit = Number.isFinite(lim) && limitDown > m * B + 0.5;

    var status = !validSubsidy ? 'Некорректная комиссия банка'
      : !(D > 0) ? 'Некорректная стоимость квартиры'
      : loan <= 0 ? 'Кредит не нужен'
      : (p.minPrice != null && B < p.minPrice) ? 'Не для этой квартиры'
      : loan > lim + 0.5 ? 'Кредит больше лимита'
      : pvShare > p.maxPv + 1e-9 ? 'Взнос больше допустимого'
      : loan < p.minLoan ? 'Кредит меньше минимального'
      : OK;

    // Срок: введённый, но в пределах программы; пусто — максимальный
    var minTerm = Math.min(p.minTerm, p.maxTerm);
    var term = inp.term != null ? Math.min(Math.max(inp.term, minTerm), p.maxTerm) : p.maxTerm;
    var n = Math.round(term * 12);
    // Льготный период считаем, только если ставка после него другая
    var g = Math.abs(p.r2 - p.r1) < 1e-12 ? 0 : Math.min(Math.round(p.grace * 12), n);
    var pay1 = pmt(p.r1 / 12, n, loan);
    var bal = g ? balanceAfter(p.r1 / 12, g, pay1, loan) : 0;
    var pay2 = g ? pmt(p.r2 / 12, n - g, bal) : pay1;
    var total = g ? pay1 * g + pay2 * (n - g) : pay1 * n;

    var note = status === 'Взнос больше допустимого' ? 'Программа для взноса до ' + pct1(p.maxPv)
      : status === 'Кредит меньше минимального' ? 'Программа для кредита от ' + rub(p.minLoan)
      : status === 'Не для этой квартиры' ? 'Программа для квартир от ' + rub(p.minPrice)
      : status !== OK ? ''
      : byLimit && pv <= minPvRub + 0.5 ? 'Взнос больше ' + pct1(m) + ': кредит по программе — не больше ' + rub(lim)
      : pvIn > 0 && pv > pvIn + 0.5 ? 'Взнос увеличен до минимального по программе'
      : inp.term != null && inp.term > term ? 'Срок уменьшен до максимального по программе'
      : inp.term != null && inp.term < term ? 'Срок увеличен до минимального по программе' : '';

    return {
      id: p.id, name: p.name, r1: p.r1, r2: g ? p.r2 : p.r1, graceMonths: g, term: term,
      minPv: m, maxPv: p.maxPv, limit: lim, sub: s, subsidy: subsidy, surplus: surplus,
      cashPrice: D, compensationCap: cap, companyCompensation: companyCompensation, clientSubsidy: clientSubsidy,
      compensationWarning: inp.companyPays === true && s>0 && inp.compensationLimit == null ? 'Лимит компенсации компании не задан в инструментах. Компенсация не учтена; уточните настройки.' : '',
      promotions: inp.appliedPromotions || [],
      price: price, disc: B > 0 ? 1 - price / B : 0, minPvRub: minPvRub, pv: pv, pvShare: pvShare, loan: loan,
      pay1: pay1, pay2: pay2, total: total, over: Math.max(total - loan, 0),
      status: status, ok: status === OK, note: note, pvRaised: pvIn > 0 && pv > pvIn + 0.5
    };
  }

  // Дешевле — меньше платёж; при равном платеже — меньше цена квартиры
  function cheaper(a, b) { return (a.pay1 - b.pay1) || (a.price - b.price) || (a.id - b.id); }

  // inp: { project, type, kids, base, disc, pv, term, pick } — pick: id программы, выбранной вручную
  function mortgage(D, inp, opts) {
    if (!(Number.isFinite(inp.base) && inp.base > 0 && Number.isFinite(inp.disc) && inp.disc >= 0 && inp.disc < 1)) return {rows:[],best:null,picked:false};
    var rows = D.programs.filter(function (p) {
      return forProject(p, inp.project) && p.type === inp.type && (!p.kids || p.kids === inp.kids);
    }).map(function (p) {
      var actions = selectedPromotions(D, p, inp), cash = inp.cash > 0 ? inp.cash : inp.base * (1 - inp.disc);
      // Основная скидка уже включена в акционную цену; повторно её не прибавляем.
      var cashRecord = D.cashDiscounts[inp.project] || D.cashDiscounts[PROJECT_KEYS[inp.project]];
      actions = actions.filter(function(a){return !cashRecord || a.id !== cashRecord.catalogId;});
      var cashWithActions = discountedPrice(inp.base, 1 - cash / inp.base, promotionRates(D.promotions, inp.project, p, inp.promotionIds), p.extraSequential?'sequential':'sum');
      var next = Object.assign({}, inp, {cash: cashWithActions, disc: 1 - cashWithActions / inp.base,
        compensationLimit: inp.compensationLimit == null ? compensationLimit(D, inp.project) : inp.compensationLimit,
        appliedPromotions: actions});
      return calcProgram(p, next, opts);
    });

    // Подходящие — по возрастанию платежа, неподходящие — в конце
    rows.sort(function (a, b) { return (b.ok - a.ok) || cheaper(a, b); });

    var good = rows.filter(function (r) { return r.ok; });
    var picked = inp.pick != null ? good.filter(function (r) { return r.id === inp.pick; })[0] : null;
    var best = picked;
    if (!best && good.length) {
      // Взнос указан — сначала программы, где его хватает. Не указан — сравниваем платежи среди программ
      // с наименьшим взносом, иначе выигрывает программа, где платёж ниже только из-за большего взноса
      var pvIn = inp.pv || 0;
      var minShare = Math.min.apply(null, good.map(function (r) { return r.pvShare; }));
      var fit = good.filter(function (r) { return pvIn > 0 ? !r.pvRaised : r.pvShare <= minShare + 0.005; });
      best = (fit.length ? fit : good)[0];
    }
    return { rows: rows, best: best || null, picked: !!picked };
  }

  /* ================== РАССРОЧКА ==================
     Схемы: equal — взнос и остаток равными платежами; monthly — взнос, фиксированный ежемесячный платёж
     и остаток к дате погашения; deferred — взнос и остаток одним платежом. */
  var STEP_NAMES = { 1: 'ежемесячно', 2: 'раз в 2 месяца', 3: 'раз в квартал', 6: 'раз в полгода', 12: 'раз в год' };

  function pvOptions(p) {
    return uniq([p.minPv].concat([.4, .5, .6, .7, .71, 1].filter(function(v){return v > p.minPv;})));
  }
  function milestoneDate(m, today) {
    if (m.months && !m.date) return addMonths(today, m.months);
    if (typeof m.date !== 'string') return null;
    var monthOnly = /^\d{4}-\d{2}$/.test(m.date), date = toDate(monthOnly ? m.date + '-01' : m.date);
    if (!date || !Number.isFinite(date.getTime())) return null;
    if (monthOnly) return date.getMonth() === +m.date.slice(5,7)-1 ? new Date(date.getFullYear(), date.getMonth()+1, 0) : null;
    return /^\d{4}-\d{2}-\d{2}$/.test(m.date) && date.getFullYear() === +m.date.slice(0,4) &&
      date.getMonth() === +m.date.slice(5,7)-1 && date.getDate() === +m.date.slice(8,10) ? date : null;
  }

  // inp: { project, base, rooms, extra, downRub, pv: {id: доля}, step: {id: месяцев}, promotionIds }
  function installments(D, inp, today) {
    today = startOfDay(today || new Date());
    if (!(Number.isFinite(inp.base) && inp.base > 0)) return [];
    return D.installments.filter(function(p){return forProject(p,inp.project);}).map(function(p){
      var opts=pvOptions(p), requested=inp.downShare!=null?inp.downShare:inp.pv && inp.pv[p.id];
      var share=Number.isFinite(requested) && requested>=p.minPv && requested<=1 ? requested : p.minPv;
      var actions=selectedPromotions(D,p,inp);
      // Произвольная доп. скидка остаётся только у старых карточек без явного списка совместимости.
      var manualExtra=p.noExtra || Array.isArray(p.compatiblePromotions)?0:Math.max(0,inp.extra||0);
      var extras=[manualExtra].concat(actions.map(function(a){return a.percent||0;}));
      var extra=combinedDiscount(extras,p.extraSequential), factor=p.extraSequential?1-extra:1;
      var cashDisc=cashDiscount(D,inp.project,today);
      var missingCashDiscount=D.cashDiscountCatalogPresent && !D.cashDiscounts[inp.project] && !D.cashDiscounts[PROJECT_KEYS[inp.project]];
      function high(v){return v>=.71-1e-12;}
      function priceAt(v){
        if(high(v))return Math.round(inp.base*(1-combinedDiscount([cashDisc].concat(extras),p.extraSequential)));
        var numerator=inp.base*(p.extraSequential?(1-p.disc)*factor:1-p.disc-extra);
        return Math.round(p.pvFromBase ? numerator-inp.base*p.discFromPv*v*factor : numerator/(1+p.discFromPv*v*factor));
      }
      function discount(v){return high(v)?cashDisc:p.disc+p.discFromPv*(p.pvFromBase?v:priceAt(v)*v/inp.base);}
      function downAt(v){return Math.min(priceAt(v),Math.round((p.pvFromBase?inp.base:priceAt(v))*v));}
      var manual=inp.downRub!=null, pvError='';
      if(inp.downShare!=null && (!Number.isFinite(inp.downShare)||inp.downShare<p.minPv||inp.downShare>1))pvError='Доля взноса должна быть от '+pct1(p.minPv)+' до 100%.';
      if(manual){
        var amount=inp.downRub;
        if(!Number.isSafeInteger(amount)||amount<0)pvError='Введите корректную сумму взноса.';
        else if(p.pvFromBase)share=amount/inp.base;
        else{
          var highPrice=priceAt(1), highShare=highPrice>0?amount/highPrice:0;
          // Доля ПВ от цены договора: отдельно решаем стандартную и льготную ветви цены.
          var lowPrice=Math.round(inp.base*(p.extraSequential?(1-p.disc)*factor:1-p.disc-extra)-amount*p.discFromPv*factor);
          share=high(highShare)?highShare:(lowPrice>0?amount/lowPrice:0);
        }
        if(!pvError && share<p.minPv-1e-9){
          var min=downAt(p.minPv);pvError='Минимальный взнос '+rub(min)+'. Не хватает '+rub(Math.max(0,min-amount))+'.';
        }
      }
      var own=discount(share), total=priceAt(share), pv=manual?inp.downRub:downAt(share), rest=total-pv;
      var end=p.end || addMonths(today,p.months);
      var card={id:p.id,name:p.name,kind:p.kind,note:p.note,disc:own,baseDisc:own,launchDisc:0,extra:extra,total:total,saved:inp.base-total,end:end,
        termMonths:monthsBetween(today,end),share:share,pvFromBase:p.pvFromBase,extraSequential:p.extraSequential,
        cashDiscountApplied:high(share)&&!missingCashDiscount,promotions:actions,
        warning:p.validUntil && today>p.validUntil?'Срок действия условий в источнике истёк '+dmy(p.validUntil)+'. Расчёт справочный; подтвердите условия.':'',
        pvOptions:opts.length>1?opts.map(function(v){return {share:v,disc:discount(v)};}):null,
        rows:[{when:'в день сделки',label:'Первый взнос',sub:pct1(share)+(p.pvFromBase?' прайса':' стоимости'),amount:pv}]};
      function fail(message){card.error=message;card.rows=[];return card;}
      if(end<=today)return fail('Срок погашения уже прошёл. Программа не рассчитывается.');
      if(pvError)return fail(pvError);
      if(high(share)&&missingCashDiscount)return fail('В каталоге нет действующих условий скидки при 100% оплате для этого проекта. Расчёт при ПВ от 71% недоступен.');
      if(!(total>0) || !Number.isFinite(total))return fail('Скидка и взнос несовместимы: стоимость не положительна.');
      if(rest===0){card.fullPayment=true;card.rows[0].sub='100% стоимости договора';return card;}
      // Ежемесячная схема может включать отдельные этапы; equal/deferred их игнорируют.
      var milestones=(p.kind==='scheduled'||p.kind==='monthly')?p.milestones.map(function(m){
        var date=milestoneDate(m,today), month=typeof m.date==='string' && m.date.length===7;
        return {date:date,when:month && date?date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})+' (день уточняется)':'до '+dmy(date),
          amount:m.amount!=null?m.amount:Math.round(total*m.share),sub:m.amount!=null?'По условиям программы':pct1(m.share)+' стоимости'};
      }).sort(function(a,b){return a.date-b.date;}):[];
      if(milestones.some(function(m){return !m.date || m.date<=today || m.date>end;}))return fail('Дата промежуточного платежа не входит в срок рассрочки. Уточните индивидуальный график.');
      if(milestones.some(function(m){return !Number.isSafeInteger(m.amount) || m.amount<0;}))return fail('Укажите корректную сумму каждого этапа.');
      var reserved=milestones.reduce(function(sum,m){return sum+m.amount;},0);
      var monthly=p.kind==='monthly'?(p.pay[inp.rooms]||p.pay[1]||0):0;
      var cnt=monthly>0?Math.max((end.getFullYear()-today.getFullYear())*12+end.getMonth()-today.getMonth()-1,0):0;
      if(!Number.isSafeInteger(monthly)||monthly<0)return fail('Укажите корректную сумму ежемесячного платежа.');
      if(reserved+monthly*cnt>0){
        // Обязательный график не сокращается при увеличении ПВ. Максимум ищем
        // отдельно до/после порога 71%: цена и процентные этапы меняются вместе.
        var cashPrice=priceAt(1), numerator=inp.base*(p.extraSequential?(1-p.disc)*factor:1-p.disc-extra);
        var threshold=Math.ceil((.71-1e-12)*(p.pvFromBase?inp.base:cashPrice));
        function priceForAmount(amount,isHigh){return isHigh?cashPrice:Math.round(numerator-amount*p.discFromPv*factor);}
        function obligations(price){
          return monthly*cnt+p.milestones.reduce(function(sum,m){return sum+(m.amount!=null?m.amount:Math.round(price*m.share));},0);
        }
        function maxDown(lo,hi,isHigh){
          function fits(amount){var price=priceForAmount(amount,isHigh);return price>0 && amount+obligations(price)<=price;}
          if(hi<lo || !fits(lo))return -1;
          while(lo<hi){var mid=lo+Math.ceil((hi-lo)/2);if(fits(mid))lo=mid;else hi=mid-1;}
          var price=priceForAmount(lo,isHigh), ratio=lo/(p.pvFromBase?inp.base:price);
          return ratio>=p.minPv-1e-9 && high(ratio)===isHigh?lo:-1;
        }
        var lowMax=maxDown(0,Math.max(-1,threshold-1),false);
        var highMax=missingCashDiscount?-1:maxDown(Math.max(0,threshold),Math.max(0,cashPrice),true);
        card.maxPvRub=Math.max(lowMax,highMax);
        if(card.maxPvRub<0)return fail('При этой цене обязательные платежи графика не оставляют места для допустимого первоначального взноса. Уточните условия программы.');
        var maxPrice=priceForAmount(card.maxPvRub,highMax>=lowMax);
        card.maxPvShare=card.maxPvRub/(p.pvFromBase?inp.base:maxPrice);
        card.pvLimit='Максимальный первоначальный взнос для рассрочки — '+rub(card.maxPvRub)+' ('+pct1(card.maxPvShare)+(p.pvFromBase?' прайса':' стоимости договора')+'). Обязательные платежи графика сохраняются. При полной оплате 100% график не требуется.';
        if(reserved+monthly*cnt>rest)return fail(card.pvLimit+' Уменьшите первоначальный взнос.');
      }
      if(pv>total)return fail('Введённый взнос превышает цену в договоре '+rub(total)+'.');
      if(p.kind==='equal'){
        var step=inp.step && p.steps.indexOf(inp.step[p.id])>=0?inp.step[p.id]:p.steps[0];
        // Один платёж на период; остаток округления погашается последним платежом.
        var n=Math.max(Math.ceil(((end.getFullYear()-today.getFullYear())*12+end.getMonth()-today.getMonth())/step),1);
        card.step=step;card.steps=p.steps.length>1?p.steps.map(function(v){return {step:v,name:STEP_NAMES[v]};}):null;
        card.payment=Math.floor(rest/n);var finalPay=rest-card.payment*(n-1);
        if(n>1)card.rows.push({when:STEP_NAMES[step],label:'Равные платежи',sub:(n-1)+' '+plural(n-1,'платёж','платежа','платежей')+' по '+rub(card.payment),amount:card.payment*(n-1)});
        card.rows.push({when:'до '+dmy(end),label:'Последний платёж',sub:'с учётом округления',amount:finalPay,final:true});
      }else{
        if(p.kind==='monthly'){
          card.payment=cnt?monthly:0;
          if(cnt)card.rows.push({when:'ежемесячно',label:'Платежи',sub:rub(monthly)+' × '+months(cnt)+'; со следующего месяца, до месяца погашения',amount:monthly*cnt});
          rest-=monthly*cnt;
        }
        milestones.forEach(function(m){card.rows.push({when:m.when,label:'Промежуточный платёж',sub:m.sub,amount:m.amount,date:m.date});rest-=m.amount;});
        if(rest>0)card.rows.push({when:'до '+dmy(end),label:'Остаток',sub:pct1(rest/total)+' стоимости',amount:rest,final:true});
      }
      return card;
    });
  }

  root.SMCalc = {
    buildData: buildData, kidsOptions: kidsOptions, mortgage: mortgage, installments: installments, pmt: pmt, OK: OK, cashDiscount: cashDiscount, compensationLimit: compensationLimit, compatiblePromotions: compatiblePromotions,
    promotionRates: promotionRates, discountedPrice: discountedPrice,
    fmt: { rub: rub, pct: pct, pct1: pct1, pct0: pct0, years: years, months: months, period: period, dmy: dmy, plural: plural, int: function (v) { return nf0.format(v); } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
