/* Еженедельный снимок рассрочек ДА. Условия ДНК хранятся отдельно. */
(function () {
  'use strict';
  var projects=['ДА — 1 очередь','ДА — 2 очередь'];
  function validDate(value) {
    return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  }
  function number(n,min,max) {return Number.isFinite(n) && n>=min && n<=max;}
  function validate(data) {
    if(!data || data.version!==1 || !Array.isArray(data.programs) || data.programs.length!==8)throw new Error('Формат снимка');
    var checked=Date.parse(data.checked_at);
    if(!Number.isFinite(checked) || checked>Date.now()+3600000)throw new Error('Дата снимка');
    data.programs.forEach(function(p){
      if(!p || !Array.isArray(p.projects) || p.projects.length!==1 || !projects.includes(p.projects[0]) ||
        typeof p.name!=='string' || !p.name.trim() || typeof p.note!=='string' || !number(p.minPv,0,.9) ||
        !validDate(p.validUntil) || p.extraSequential!==true ||
        (p.end?(!validDate(p.end)||p.months!=null):(!Number.isInteger(p.months)||!number(p.months,1,60))))throw new Error('Условия программы');
      if(p.scheme==='equal'){
        if(!number(p.discFromPv,0,.9)||(p.maxDisc!=null && !number(p.maxDisc,0,.9))||p.pvFromBase!==true||
          !Array.isArray(p.steps)||!p.steps.length||p.steps.some(function(n){return ![1,3,6].includes(n);}))throw new Error('Равные платежи');
      }else if(p.scheme==='monthly'){
        if(!p.pay || [1,2,3].some(function(n){return !Number.isInteger(p.pay[n])||!number(p.pay[n],1,1000000);}) || !number(p.disc,0,.9))throw new Error('Ежемесячные платежи');
      }else if(p.scheme!=='deferred'||!number(p.disc,0,.9))throw new Error('Схема программы');
    });
    projects.forEach(function(project){
      var rows=data.programs.filter(function(p){return p.projects[0]===project;});
      if(rows.length!==4 || rows.filter(function(p){return p.scheme==='equal';}).length!==1 ||
        rows.filter(function(p){return p.scheme==='monthly';}).length!==1 ||
        rows.filter(function(p){return p.scheme==='deferred';}).length!==2 || new Set(rows.map(function(p){return p.name;})).size!==4)throw new Error('Неполный проект');
    });
    return checked;
  }
  window.SM_INSTALLMENTS_READY=(async function(){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},12000);
    try {
      var response=await fetch('assets/installments.json',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Снимок недоступен');
      var data=await response.json(),checked=validate(data);
      var others=window.SM_DATA.installments.filter(function(p){return !p.projects.some(function(project){return projects.includes(project);});});
      window.SM_DATA.installments=data.programs.concat(others);
      window.SM_INSTALLMENTS_STATUS={checkedAt:checked,stale:Date.now()-checked>8*86400000,fallback:false};
    }catch(e){window.SM_INSTALLMENTS_STATUS={fallback:true};}
    finally{clearTimeout(timer);}
  })();
})();
