/* Проверенный сервером снимок ставок. Внутренних ссылок Google в браузере нет. */
(function () {
  'use strict';
  var projects=['ДА — 1 очередь','ДА — 2 очередь','ДНК — 2 очередь'];
  function validate(data) {
    if(!data || data.version!==1 || !Array.isArray(data.programs) || !data.programs.length || data.programs.length>400)throw new Error('Формат снимка');
    var checked=Date.parse(data.checked_at);
    if(!Number.isFinite(checked) || checked>Date.now()+3600000)throw new Error('Дата снимка');
    data.programs.forEach(function(p){
      if(!p || !Array.isArray(p.projects) || !p.projects.length || p.projects.some(function(x){return !projects.includes(x);}) ||
        !['Семейная ипотека','Базовая ипотека'].includes(p.type) || typeof p.bank!=='string' || !p.bank.trim() ||
        !Number.isInteger(p.term) || p.term<1 || p.term>30 || !Number.isFinite(p.rate) || p.rate<=0 || p.rate>.5 ||
        !Number.isFinite(p.subsidy) || p.subsidy<0 || p.subsidy>.5 || !Number.isFinite(p.minPv) || p.minPv<0 || p.minPv>=1 ||
        (p.type==='Семейная ипотека' && (!p.kids || !Number.isFinite(p.limit) || p.limit<=0)))throw new Error('Некорректная программа');
    });
    if(projects.some(function(project){return !data.programs.some(function(p){return p.projects.includes(project);});}))throw new Error('Отсутствует проект');
    return checked;
  }
  window.SM_MORTGAGE_READY=(async function(){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},12000);
    try {
      var response=await fetch('assets/mortgage.json',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Снимок недоступен');
      var data=await response.json(),checked=validate(data);
      window.SM_DATA.mortgage=data.programs;
      window.SM_MORTGAGE_STATUS={checkedAt:checked,stale:Date.now()-checked>12*3600000,fallback:false};
    }catch(e){
      // Проверенная встроенная копия остаётся доступна, но её возраст явно указан.
      window.SM_MORTGAGE_STATUS={fallback:true};
    }finally{clearTimeout(timer);}
  })();
})();
