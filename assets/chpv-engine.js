/* Формулы листа «Расчёт ЧПВ». Денежные значения сохраняются без округления до вывода. */
(function (root) {
  'use strict';
  function calculate(x) {
    if(![x.base,x.cash,x.ddu].every(function(v){return Number.isFinite(v)&&v>0;}) || !(Number.isFinite(x.client)&&x.client>=0) || !(x.minDown>0&&x.minDown<1) || !(x.years>0&&x.years<=30)) throw new Error('Проверьте цены, средства клиента, взнос и срок.');
    if(x.client>x.ddu*x.minDown) throw new Error('Средств клиента больше суммы ПВ по ДДУ. Субсидирование ПВ не требуется; используйте обычную ипотеку.');
    var m = x.minDown, loanMonths = x.years * 12;
    var minimum = x.base * m, shortage = minimum - x.client;
    var down = x.ddu * m, funded = down - x.client, cost = funded * x.cost;
    var profit = x.cash - (x.ddu - funded - cost);
    var loan = x.ddu - down, excess = Math.max(0, loan - x.limit);
    var rate = excess > 0 ? x.overRate : (down / x.ddu >= .5 ? Math.min(x.rate, .06) : x.rate);
    var payment = root.SMCalc.pmt(rate / 12, loanMonths, loan);
    return { minimum: minimum, shortage: shortage, shortagePct: shortage / minimum, down: down,
      funded: funded, fundedPct: funded / down, cost: cost, profit: profit, rise: x.ddu - x.cash,
      loan: loan, excess: excess, rate: rate, payment: payment, agent: x.base * .035,
      verdict: profit > 1000 ? 'Не подходит' : excess > 0 ? 'Комбо-ипотека' : 'Подходит' };
  }
  function suggested(x) {
    var denominator = 1 - x.minDown * (1 + x.cost);
    if (denominator <= 0) return null;
    var amount = (x.cash - (1 + x.cost) * x.client - 1000) / denominator;
    return Math.max(0, Math.ceil(amount / 1000) * 1000);
  }
  root.SMChpvCalc = { calculate: calculate, suggested: suggested };
})(window);
