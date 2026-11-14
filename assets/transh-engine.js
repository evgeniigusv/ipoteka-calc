/* Предварительная модель: платёж на сумму уже выданных траншей на исходный срок. */
(function(root){
  'use strict';
  function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;var d=new Date(s+'T00:00:00');return Number.isFinite(d.getTime())&&d.getFullYear()===Number(s.slice(0,4))&&d.getMonth()+1===Number(s.slice(5,7))&&d.getDate()===Number(s.slice(8,10));}
  // Только расчётный ориентир, не банковская ставка. Исходная модель ДА: 100 тыс., 1500/мес., 30 лет.
  function rateFromPayment(principal,payment,years){
    if(!(Number.isFinite(principal)&&principal>0&&Number.isFinite(payment)&&payment>0&&Number.isInteger(years)&&years>=1&&years<=30))throw new Error('Некорректный ориентир платежа.');
    var n=years*12;
    if(payment<principal/n)throw new Error('Платёж не покрывает кредит даже без процентов.');
    if(payment===principal/n)return 0;
    var low=0,high=1;
    if(payment>root.SMCalc.pmt(high/12,n,principal))throw new Error('Ориентир превышает допустимую ставку.');
    for(var i=0;i<70;i++){var mid=(low+high)/2;if(root.SMCalc.pmt(mid/12,n,principal)>payment)high=mid;else low=mid;}
    return (low+high)/2;
  }
  function addMonths(date, months){
    if(!validDate(date))return '';
    var d=new Date(date+'T00:00:00'), day=d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth()+months);
    d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function calculate(x){
    if(!(Number.isFinite(x.price)&&x.price>0&&Number.isInteger(x.years)&&x.years>=1&&x.years<=30))throw new Error('Укажите стоимость и срок от 1 до 30 лет.');
    if(!(Number.isFinite(x.rate)&&x.rate>0&&x.rate<=1))throw new Error('Введите подтверждённую ставку банка.');
    if(!(x.down>=.2&&x.down<1))throw new Error('Первоначальный взнос должен быть от 20% и меньше 100%.');
    if(!validDate(x.date1))throw new Error('Укажите дату сделки.');

    var pv=Math.round(x.price*x.down), total=x.price-pv;
    var two=+x.tranches===2, amounts, dates;
    if(x.flexibleTranches){
      if(!validDate(x.maxDate))throw new Error('Укажите крайний срок выдачи.');
      var draws=x.draws||[];
      amounts=[x.firstRub].concat(draws.map(function(draw){return draw.amount;}));
      dates=[x.firstDate].concat(draws.map(function(draw){return draw.date;}),[x.date2]);
    }else{
      if(!(two&&x.firstRub>0)&&!(x.first>0))throw new Error('Укажите долю первого транша.');
      var first=two&&x.firstRub>0?x.firstRub:Math.max(Math.round(x.price*x.first),x.minFirst||0);
      amounts=two?[first]:[first,Math.round(x.price*x.second)];
      dates=two?[x.date1,x.date2]:[x.date1,x.date2,x.date3];
    }

    var last=dates.length-1;
    if(x.lastMonthsBeforeCommissioning){
      if(x.commissioningDate&&!validDate(x.commissioningDate))throw new Error('Проверьте дату ввода.');
      dates[last]=x.commissioningDate?addMonths(x.commissioningDate,-x.lastMonthsBeforeCommissioning):'';
    }
    var end=addMonths(x.date1,12*x.years);
    dates.forEach(function(date,i){
      if(!date&&i===last&&(x.lastMonthsBeforeCommissioning||x.flexibleTranches||x.lastMonth))return;
      if(!validDate(date)||date<x.date1||(i>0&&date<=dates[i-1]))throw new Error(two?'Укажите дату сделки и даты выдач по порядку.':'Укажите даты траншей по порядку.');
      if(date>=end)throw new Error('Последний транш должен быть выдан до окончания срока ипотеки.');
      if(x.flexibleTranches&&(date>x.maxDate||(i<last&&date===x.maxDate)))throw new Error('Все транши нужно выдать до крайнего срока включительно.');
    });
    if(!dates[last]&&x.lastMonth){
      var monthStart=x.lastMonth+'-01';
      var lastDay=new Date(Number(x.lastMonth.slice(0,4)),Number(x.lastMonth.slice(5)),0).getDate();
      if(!validDate(monthStart)||dates[last-1]>=x.lastMonth+'-'+lastDay||monthStart>=end)throw new Error('Проверьте даты траншей и срок ипотеки.');
    }
    if(!amounts.every(function(amount){return Number.isSafeInteger(amount)&&amount>0;}))throw new Error('Укажите положительные суммы траншей до выдачи остатка.');
    var rest=total-amounts.reduce(function(sum,amount){return sum+amount;},0);
    if(rest<=0)throw new Error(two&&!x.flexibleTranches?'Первый транш должен быть меньше суммы кредита.':'После выдач должен оставаться положительный остаток для последнего транша.');
    amounts.push(rest);
    var issued=0;
    var stages=amounts.map(function(amount,i){
      issued+=amount;
      return {date:dates[i]||null,amount:amount,issued:issued,payment:root.SMCalc.pmt(x.rate/12,x.years*12,issued)};
    });
    return {price:x.price,down:pv,total:total,stages:stages};
  }
  root.SMTranshCalc={calculate:calculate,rateFromPayment:rateFromPayment,addMonths:addMonths};
})(window);
