(function(){
  'use strict';
  function stamp(time){
    return new Date(time).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' (Екатеринбург)';
  }
  function mortgageStatus(data,project){
    var checkedAt=Date.parse(data.mortgageCheckedAt ? data.mortgageCheckedAt[project] : data.checked_at);
    var reason=(data.mortgageWarnings||{})[project];
    var stale=Date.now()-checkedAt>12*3600000;
    var message=reason
      ? 'Субсидированные ставки из последней успешной проверки от '+stamp(checkedAt)+'. Причина: '+reason
      : 'Ставки и комиссии проверены '+stamp(checkedAt)+'. Обновление каждые 3 часа.'+(stale?' Проверка задерживается — подтвердите актуальность условий.':'');
    return {checkedAt:checkedAt,stale:stale,fallback:!!reason,message:message};
  }
  window.SMToolsMortgageNotices=function(getData){
    var status=document.getElementById('tools-status'),notice=document.createElement('details');
    notice.className='tools-alert';
    const summary=document.createElement('summary'), body=document.createElement('p');
    summary.textContent='Часть ставок показана по последней проверке';
    notice.append(summary,body);
    document.getElementById('tools-error').before(notice);
    function update(){
      var data=getData(),projects=window.SMToolsModel.projects;
      var warnings=Object.keys(data.mortgageWarnings||{}).map(function(key){
        return projects[key]+'. '+mortgageStatus(data,key).message;
      });
      notice.hidden=!warnings.length;
      body.textContent=warnings.join(' ');
    }
    update();
    // После сохранения и перечитывания редактор обновляет текст статуса каталога.
    new MutationObserver(update).observe(status,{childList:true});
  };
  window.SM_TOOLS_READY=(async function(){
    // Старые загрузчики заканчивают первыми: поздний ответ не перезапишет единый справочник.
    await Promise.all([window.SM_MORTGAGE_READY,window.SM_INSTALLMENTS_READY]);
    var local=location.hostname==='127.0.0.1'&&location.port==='8795',controller=new AbortController(),timer=setTimeout(function(){controller.abort();},local?120000:15000);
    try{
      if(local){var session=await fetch('/api/session',{cache:'no-store',signal:controller.signal});if(!session.ok)throw new Error('Личный редактор недоступен');window.SM_TOOLS_SESSION=await session.json();}
      var response=await fetch(local?'/api/tools':'assets/tools.json',{headers:local?{'X-Editor-Session':window.SM_TOOLS_SESSION.csrf}:{},cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Источник не ответил');
      var data=window.SMToolsModel.validate(await response.json()),calc=window.SMToolsModel.calcData(data);
      if(!Number.isFinite(Date.parse(data.checked_at)))throw new Error('Не указана дата проверки справочника');
      window.SM_TOOLS_DATA=data;window.SM_TOOLS_STATUS={fallback:false,checkedAt:Date.parse(data.checked_at),local:local};
      if(window.SM_DATA){window.SM_DATA.mortgage=calc.mortgage;window.SM_DATA.installments=calc.installments;window.SM_DATA.tranche=calc.tranche;window.SM_DATA.chpv=calc.chpv;window.SM_DATA.cashDiscounts=calc.cashDiscounts;}
      var byProject={};
      Object.entries(window.SMToolsModel.projects).forEach(function(pair){
        byProject[pair[1]]=mortgageStatus(data,pair[0]);
      });
      window.SM_MORTGAGE_STATUS={byProject:byProject,checkedAt:Date.parse(data.checked_at),stale:Date.now()-Date.parse(data.checked_at)>12*3600000,fallback:false};
      window.SM_INSTALLMENTS_STATUS={checkedAt:Date.parse(data.full_checked_at||data.checked_at),stale:Date.now()-Date.parse(data.full_checked_at||data.checked_at)>8*86400000,fallback:false,catalog:true};
    }catch(e){window.SM_TOOLS_STATUS={fallback:true,error:e.message};var legal=document.querySelector('.sm-foot .sm-legal');if(legal){var warning=document.createElement('span');warning.className='sm-why';warning.textContent=' Единый справочник недоступен. Используются резервные условия; подтвердите их перед оформлением.';legal.appendChild(warning);}}
    finally{clearTimeout(timer);}
  })();
})();
