/* Расчёты калькуляторов «Свобода мысли»: ипотека и рассрочка.
   К странице не обращается — те же функции проверяются тестами (tests/engine.test.mjs).

   Ипотека считается по методике таблицы «Калькулятор ЧПВ» (лист «Калькулятор субсидирования»):
     ПВ               = доля цены по прайсу (от 20,1%), и «прайс − ПВ» не больше лимита кредита
     Комиссия банку   = (Цена по прайсу − ПВ) × ставка комиссии
     Цена в договоре  = Цена со скидкой («наличка») + Комиссия банку
     Профит           = Цена по прайсу − Цена в договоре; меньше нуля — программа не проходит */
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
  function forProject(item, project) { return !item.projects.length || item.projects.indexOf(project) >= 0; }

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
        sub: p.subsidy || 0, minPrice: or(p.minPrice, null), kids: p.kids || null
      };
    });
    var inst = (raw.installments || []).map(function (p, i) {
      return {
        id: i + 1, projects: p.projects || [], name: p.name, kind: p.scheme,
        minPv: p.minPv || 0, pay: p.pay || {}, end: toDate(p.end), months: p.months || 0,
        disc: p.disc || 0, discFromPv: p.discFromPv || 0, maxDisc: or(p.maxDisc, null),
        steps: p.steps && p.steps.length ? p.steps : [1], note: p.note || '',
        pvFromBase: !!p.pvFromBase, extraSequential: !!p.extraSequential, validUntil: toDate(p.validUntil),
        milestones: p.milestones || [], pvChoices: p.pvChoices, discAt70: p.discAt70,
        launchDiscount: p.launchDiscount || 0, launchUntil: toDate(p.launchUntil), noExtra: !!p.noExtra
      };
    });
    return {
      programs: programs, installments: inst,
      projects: raw.projects || [],
      types: raw.types || uniq(programs.map(function (p) { return p.type; })),
      defaultDiscount: raw.defaultDiscount || 0
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

  // opts.loanFromBase — показывать кредит и платёж от «прайс − ПВ», как в таблице; иначе — от цены в договоре
  function calcProgram(p, inp, opts) {
    var B = inp.base, D = inp.cash > 0 ? Math.round(inp.cash) : Math.round(B * (1 - inp.disc)), pvIn = Math.round(inp.pv || 0);
    var s = p.sub, m = p.minPv, lim = p.limit;

    // Взнос считается от цены по прайсу; «прайс − взнос» не больше лимита кредита
    var minPvRub = Math.max(Math.ceil(m * B - 1e-6), B - lim, 0);
    var pv = Math.min(Math.max(pvIn, minPvRub), B);
    var credit = B - pv;                           // «Сумма кредита» в таблице
    var subsidy = credit * s;                      // «Комиссия банку, руб.»
    var price = Math.round(D + subsidy);           // «Цена реализации»: наличка + комиссия
    var surplus = B - price;                       // «Профит»: должен быть не меньше нуля
    if (pv > price) pv = price;
    var loan = opts && opts.loanFromBase ? credit : price - pv;
    var pvShare = B > 0 ? pv / B : 0;
    var byLimit = lim < Infinity && B - lim > m * B + 0.5;
    // Скидка, с которой программа проходит: комиссия не больше скидки (профит ≥ 0)
    var needDisc = B > 0 ? s * credit / B : 0;

    var status = loan <= 0 ? 'Кредит не нужен'
      : (p.minPrice != null && B < p.minPrice) ? 'Не для этой квартиры'
      : surplus < -0.5 ? 'Субсидия больше скидки'
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

    var note = status === 'Субсидия больше скидки' ? 'Доступна при скидке от ' + pct1(Math.ceil(needDisc * 1000 - 1e-6) / 1000)
      : status === 'Взнос больше допустимого' ? 'Программа для взноса до ' + pct1(p.maxPv)
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
    }).map(function (p) { return calcProgram(p, inp, opts); });

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
  var STEP_NAMES = { 1: 'ежемесячно', 3: 'раз в квартал', 6: 'раз в полгода', 12: 'раз в год' };

  // Скидка программы при взносе share: фиксированная + доля от суммы взноса, но не больше потолка
  function instDisc(p, share) {
    var d = p.disc + p.discFromPv * share;
    return p.maxDisc == null ? d : Math.min(d, p.maxDisc);
  }
  function pvOptions(p) {
    if(p.pvChoices) return p.pvChoices;
    if (p.kind !== 'equal') return [p.minPv];
    return uniq([p.minPv].concat([0.4, 0.5, 0.6, 0.7].filter(function (v) { return v > p.minPv + 1e-9; })));
  }

  // inp: { project, base, rooms: 1|2|3, extra, pv: {id: доля}, step: {id: месяцев} }
  function installments(D, inp, today) {
    today = startOfDay(today || new Date());
    if (!(Number.isFinite(inp.base) && inp.base > 0)) return [];
    return D.installments.filter(function(p){return forProject(p,inp.project);}).map(function(p){
      var opts=pvOptions(p), share=inp.pv && opts.indexOf(inp.pv[p.id])>=0 ? inp.pv[p.id] : opts[0];
      var launch=p.launchUntil && today<=p.launchUntil ? p.launchDiscount : 0;
      function discount(v){return (p.discAt70!=null && v>=.7 ? p.discAt70 : instDisc(p,v))+launch;}
      var own=discount(share), extra=p.noExtra?0:Math.max(0,inp.extra||0);
      var factor=p.extraSequential?(1-own)*(1-extra):1-own-extra;
      var total=Math.round(inp.base*factor), pv=Math.round((p.pvFromBase?inp.base:total)*share), rest=total-pv;
      var end=p.end || addMonths(today,p.months);
      var card={id:p.id,name:p.name,kind:p.kind,note:p.note,disc:own,extra:extra,total:total,saved:inp.base-total,end:end,
        termMonths:monthsBetween(today,end),share:share,pvFromBase:p.pvFromBase,extraSequential:p.extraSequential,
        warning:p.validUntil && today>p.validUntil?'Срок действия условий в источнике истёк '+dmy(p.validUntil)+'. Расчёт справочный; подтвердите условия.':'',
        pvOptions:opts.length>1?opts.map(function(v){return {share:v,disc:discount(v)};}):null,
        rows:[{when:'в день сделки',label:'Первый взнос',sub:pct1(share)+(p.pvFromBase?' прайса':' стоимости'),amount:pv}]};
      if(end<=today){card.error='Срок погашения уже прошёл. Программа не рассчитывается.';card.rows=[];return card;}
      if(!(total>0) || rest<0){card.error='Скидка и взнос несовместимы: взнос превышает стоимость или стоимость не положительна.';card.rows=[];return card;}
      var milestones=p.milestones.map(function(m){var month=m.date && m.date.length===7;return {date:m.months?addMonths(today,m.months):toDate(month?m.date+'-31':m.date),when:month?toDate(m.date+'-01').toLocaleDateString('ru-RU',{month:'long',year:'numeric'})+' (день уточняется)':'до '+dmy(m.months?addMonths(today,m.months):toDate(m.date)),amount:Math.round(total*m.share),sub:pct1(m.share)+' стоимости'};});
      if(milestones.some(function(m){return m.date<=today || m.date>=end;})){card.error='Дата промежуточного платежа не входит в срок рассрочки. Уточните индивидуальный график.';card.rows=[];return card;}
      var reserved=milestones.reduce(function(sum,m){return sum+m.amount;},0);
      if(reserved>rest){card.error='Промежуточные платежи превышают остаток.';card.rows=[];return card;}
      if(p.kind==='equal'){
        var step=inp.step && p.steps.indexOf(inp.step[p.id])>=0?inp.step[p.id]:p.steps[0];
        // Один платёж на период со следующего месяца; более поздний день погашения не добавляет ещё один платёж.
        var n=Math.max(Math.ceil(((end.getFullYear()-today.getFullYear())*12+end.getMonth()-today.getMonth())/step),1);
        card.step=step;card.steps=p.steps.length>1?p.steps.map(function(v){return {step:v,name:STEP_NAMES[v]};}):null;
        card.payment=Math.floor(rest/n);var finalPay=rest-card.payment*(n-1);
        if(n>1)card.rows.push({when:STEP_NAMES[step],label:'Равные платежи',sub:(n-1)+' '+plural(n-1,'платёж','платежа','платежей')+' по '+rub(card.payment),amount:card.payment*(n-1)});
        card.rows.push({when:'до '+dmy(end),label:'Последний платёж',sub:'с учётом округления',amount:finalPay,final:true});
      }else{
        if(p.kind==='monthly'){
          var monthly=p.pay[inp.rooms]||p.pay[1]||0;
          var cnt=Math.max((end.getFullYear()-today.getFullYear())*12+end.getMonth()-today.getMonth()-1,0);
          cnt=monthly>0?Math.min(cnt,Math.floor((rest-reserved)/monthly)):0;
          card.payment=cnt?monthly:0;
          if(cnt)card.rows.push({when:'ежемесячно',label:'Платежи',sub:rub(monthly)+' × '+months(cnt)+'; со следующего месяца, до месяца погашения',amount:monthly*cnt});
          rest-=monthly*cnt;
        }
        milestones.forEach(function(m){card.rows.push({when:m.when,label:'Промежуточный платёж',sub:m.sub,amount:m.amount});rest-=m.amount;});
        card.rows.push({when:'до '+dmy(end),label:'Остаток',sub:pct1(rest/total)+' стоимости',amount:rest,final:true});
      }
      return card;
    });
  }

  root.SMCalc = {
    buildData: buildData, kidsOptions: kidsOptions, mortgage: mortgage, installments: installments, pmt: pmt, OK: OK,
    fmt: { rub: rub, pct: pct, pct1: pct1, years: years, months: months, period: period, dmy: dmy, plural: plural, int: function (v) { return nf0.format(v); } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
