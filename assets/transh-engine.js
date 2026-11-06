/* Предварительная модель: платёж на сумму уже выданных траншей на исходный срок. */
(function(root){
  'use strict';
  function calculate(x){
    if (!(x.price > 0) || !(x.rate > 0) || !(Number.isInteger(x.years) && x.years >= 1 && x.years <= 30)) throw new Error('Укажите стоимость, ставку и срок от 1 до 30 лет.');
    if (!(x.down >= 0.20 && x.down < 1)) throw new Error('Первоначальный взнос должен быть от 20% и меньше 100%.');
    var two = x.tranches === 2;
    if (two ? !(x.firstRub > 0) : !(x.first > 0 && x.second > 0)) throw new Error('Укажите сумму первого транша и условия программы.');
    if (!x.date1 || !x.date2 || !(x.date1 < x.date2) || (!two && (!x.date3 || !(x.date2 < x.date3)))) throw new Error(two ? 'Укажите дату сделки и дату второго транша по порядку.' : 'Укажите три даты по порядку: сделка, второй и последний транш.');
    var start = new Date(x.date1 + 'T00:00:00'), end = new Date(start); end.setFullYear(end.getFullYear() + x.years);
    if (new Date((two ? x.date2 : x.date3) + 'T00:00:00') >= end) throw new Error('Последний транш должен быть выдан до окончания срока ипотеки.');
    var pv = Math.round(x.price*x.down), total = x.price-pv;
    var first = two ? Math.round(x.firstRub) : Math.max(Math.round(x.price*x.first), x.minFirst || 0);
    var second = two ? total-first : Math.round(x.price*x.second);
    var third = total-first-second;
    if (two ? second <= 0 : third <= 0) throw new Error(two ? 'Первый транш должен быть меньше суммы кредита.' : 'Первый взнос и первые транши должны оставлять положительный остаток для третьего транша.');
    var n=Math.round(x.years*12), rate=x.rate/12;
    var stages=two ? [{date:x.date1,amount:first,issued:first},{date:x.date2,amount:second,issued:total}] : [{date:x.date1,amount:first,issued:first},{date:x.date2,amount:second,issued:first+second},{date:x.date3,amount:third,issued:total}];
    stages.forEach(function(s){s.payment=root.SMCalc.pmt(rate,n,s.issued);});
    return {price:x.price,down:pv,total:total,stages:stages};
  }
  root.SMTranshCalc={calculate:calculate};
})(window);
