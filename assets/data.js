/* Данные калькуляторов — снимок на дату updated. Обновляется вручную, по просьбе: страница таблицы сама не читает.

   Ипотека — таблица «Калькулятор ЧПВ»:
   - программы, банки, ставки, сроки и комиссии банку — лист «Справочник субсидий»;
   - лимиты кредита по числу детей — лист «Справочник ипотек»;
   - мин. ПВ 20,1% и формула цены — лист «Калькулятор субсидирования».
   Рассрочка — таблица «Инструменты продаж СМ», лист последнего месяца (сейчас «10-2026»);
   потолок скидки 7% в рассрочке от 30% — «Калькулятор ЧПВ», лист «Скидки на рассрочку». */
(function () {
  var FAMILY = 'Семейная ипотека', BASE = 'Базовая ипотека';
  var K1 = '1 ребёнок', K2 = '2 ребёнка', K3 = '3 ребёнка', K4 = '4 ребёнка', K5 = '5 и более детей';
  var STD = 'стандартная ставка', SUB = 'субсидированная ставка';

  window.SM_DATA = {
    updated: '13.10.2026',

    projects: ['ДА — 1 очередь', 'ДА — 2 очередь'],
    types: [FAMILY, BASE],
    defaultDiscount: 0.13, // разница между ценой по прайсу и ценой «за наличку»
    minPv: 0.201,
    limitsByKids: { '1 ребёнок': 6000000, '2 ребёнка': 8000000, '3 ребёнка': 10000000, '4 ребёнка': 10000000, '5 и более детей': 10000000 },

    /* Ипотека: строка = строка «Справочника субсидий». term — срок кредита, лет; rate — ставка;
       subsidy — комиссия банку (доля кредита); kids — условие по числу детей; variant — условие базовой ипотеки.
       Реже нужны: limit (лимит кредита, если он не по числу детей), projects (если программа не для всех очередей),
       rateAfter и graceYears (ставка после льготного периода), minPv, maxPv, minLoan, minPrice. */
    mortgage: [
      { type: FAMILY, bank: 'ДОМ.РФ', kids: K1, term: 15, rate: 0.071, subsidy: 0.1176 },
      { type: FAMILY, bank: 'ДОМ.РФ', kids: K2, term: 15, rate: 0.051, subsidy: 0.1745 },
      { type: FAMILY, bank: 'ДОМ.РФ', kids: K3, term: 15, rate: 0.035, subsidy: 0.1474 },
      { type: FAMILY, bank: 'ДОМ.РФ', kids: K4, term: 15, rate: 0.025, subsidy: 0.1830 },

      { type: FAMILY, bank: 'Альфа-Банк', kids: K1, term: 15, rate: 0.08, subsidy: 0.1029 },
      { type: FAMILY, bank: 'Альфа-Банк', kids: K1, term: 15, rate: 0.06, subsidy: 0.1772 },
      { type: FAMILY, bank: 'Альфа-Банк', kids: K2, term: 15, rate: 0.06, subsidy: 0.1181 },

      { type: FAMILY, bank: 'ВТБ', kids: K1, term: 15, rate: 0.08, subsidy: 0.1010 },
      { type: FAMILY, bank: 'ВТБ', kids: K1, term: 15, rate: 0.06, subsidy: 0.1743 },
      { type: FAMILY, bank: 'ВТБ', kids: K1, term: 30, rate: 0.08, subsidy: 0.1180 },
      { type: FAMILY, bank: 'ВТБ', kids: K1, term: 30, rate: 0.06, subsidy: 0.2104 },
      { type: FAMILY, bank: 'ВТБ', kids: K2, term: 15, rate: 0.06, subsidy: 0.1045 },
      { type: FAMILY, bank: 'ВТБ', kids: K2, term: 15, rate: 0.04, subsidy: 0.1814 },
      { type: FAMILY, bank: 'ВТБ', kids: K2, term: 30, rate: 0.06, subsidy: 0.1261 },
      { type: FAMILY, bank: 'ВТБ', kids: K2, term: 30, rate: 0.04, subsidy: 0.2241 },
      { type: FAMILY, bank: 'ВТБ', kids: K3, term: 15, rate: 0.02, subsidy: 0.1088 },
      { type: FAMILY, bank: 'ВТБ', kids: K3, term: 30, rate: 0.02, subsidy: 0.1345 },

      { type: FAMILY, bank: 'Сбербанк', kids: K1, term: 15, rate: 0.075, subsidy: 0.161 },
      { type: FAMILY, bank: 'Сбербанк', kids: K2, term: 15, rate: 0.055, subsidy: 0.161 },
      { type: FAMILY, bank: 'Сбербанк', kids: K3, term: 15, rate: 0.035, subsidy: 0.161 },
      { type: FAMILY, bank: 'Сбербанк', kids: K4, term: 15, rate: 0.015, subsidy: 0.161 },
      { type: FAMILY, bank: 'Сбербанк', kids: K5, term: 15, rate: 0.006, subsidy: 0.09 },

      { type: BASE, bank: 'ДОМ.РФ', variant: STD, term: 30, rate: 0.188, subsidy: 0 },
      { type: BASE, bank: 'ДОМ.РФ', variant: SUB, term: 30, rate: 0.132, subsidy: 0.1525 },
      { type: BASE, bank: 'Альфа-Банк', variant: SUB, term: 10, rate: 0.1249, subsidy: 0.0928 },
      { type: BASE, bank: 'Альфа-Банк', variant: SUB, term: 15, rate: 0.1249, subsidy: 0.1277 },
      { type: BASE, bank: 'Альфа-Банк', variant: SUB, term: 20, rate: 0.1249, subsidy: 0.1562 },
      { type: BASE, bank: 'Альфа-Банк', variant: SUB, term: 30, rate: 0.1249, subsidy: 0.1526 },
      { type: BASE, bank: 'Сбербанк', variant: SUB, term: 30, rate: 0.13, subsidy: 0.155 }
    ],

    /* Рассрочка. scheme: equal — остаток равными платежами; monthly — фиксированный ежемесячный платёж и остаток к дате;
       deferred — остаток одним платежом. end — погашение до (или months — срок от дня сделки).
       disc — скидка программы; discFromPv — скидка от суммы первого взноса; maxDisc — потолок скидки;
       steps — как часто платить (1 — раз в месяц, 3 — в квартал, 6 — в полгода);
       pay — ежемесячный платёж: 1 — студия и 1-комн., 2 — 2-комн., 3 — 3-комн. и больше. */
    installments: [
      { projects: ['ДА — 1 очередь'], name: 'Рассрочка от 30%', scheme: 'equal', minPv: 0.30, end: '2027-03-20', steps: [1, 3],
        discFromPv: 0.13, maxDisc: 0.07, note: 'Остаток — равными платежами. Чем больше первый взнос, тем больше скидка.' },
      { projects: ['ДА — 2 очередь'], name: 'Рассрочка от 30%', scheme: 'equal', minPv: 0.30, end: '2028-07-05', steps: [1, 3, 6],
        discFromPv: 0.13, maxDisc: 0.07, note: 'Остаток — равными платежами. Чем больше первый взнос, тем больше скидка.' },
      { projects: ['ДА — 1 очередь'], name: 'Рассрочка с ежемесячным платежом', scheme: 'monthly', minPv: 0.10, end: '2027-03-01',
        pay: { 1: 50000, 2: 75000, 3: 100000 }, disc: 0.06, note: 'Платежи вносятся с 1 по 5 число. Позже можно перейти на ипотеку.' },
      { projects: ['ДА — 2 очередь'], name: 'Рассрочка с ежемесячным платежом', scheme: 'monthly', minPv: 0.10, end: '2028-07-05',
        pay: { 1: 50000, 2: 75000, 3: 100000 }, note: 'Платежи вносятся с 1 по 5 число. Позже можно перейти на ипотеку.' }
    ]
  };
})();
