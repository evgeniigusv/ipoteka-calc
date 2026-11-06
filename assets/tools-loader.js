(function(){
  'use strict';
  window.SM_TOOLS_READY=(async function(){
    // Старые загрузчики заканчивают первыми: поздний ответ не перезапишет единый справочник.
    await Promise.all([window.SM_MORTGAGE_READY,window.SM_INSTALLMENTS_READY]);
    var local=location.hostname==='127.0.0.1'&&location.port==='8795',controller=new AbortController(),timer=setTimeout(function(){controller.abort();},15000);
    try{
      if(local){var session=await fetch('/api/session',{cache:'no-store',signal:controller.signal});if(!session.ok)throw new Error('Личный редактор недоступен');window.SM_TOOLS_SESSION=await session.json();}
      var response=await fetch(local?'/api/tools':'assets/tools.json',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Источник не ответил');
      var data=window.SMToolsModel.validate(await response.json()),calc=window.SMToolsModel.calcData(data);
      if(!Number.isFinite(Date.parse(data.checked_at)))throw new Error('Не указана дата проверки справочника');
      window.SM_TOOLS_DATA=data;window.SM_TOOLS_STATUS={fallback:false,checkedAt:Date.parse(data.checked_at),local:local};
      if(window.SM_DATA){window.SM_DATA.mortgage=calc.mortgage;window.SM_DATA.installments=calc.installments;window.SM_DATA.tranche=calc.tranche;window.SM_DATA.chpv=calc.chpv;window.SM_DATA.cashDiscounts=calc.cashDiscounts;}
      window.SM_MORTGAGE_STATUS={checkedAt:Date.parse(data.checked_at),stale:Date.now()-Date.parse(data.checked_at)>12*3600000,fallback:false};
      window.SM_INSTALLMENTS_STATUS={checkedAt:Date.parse(data.full_checked_at||data.checked_at),stale:Date.now()-Date.parse(data.full_checked_at||data.checked_at)>8*86400000,fallback:false,catalog:true};
    }catch(e){window.SM_TOOLS_STATUS={fallback:true,error:e.message};var legal=document.querySelector('.sm-foot .sm-legal');if(legal){var warning=document.createElement('span');warning.className='sm-why';warning.textContent=' Единый справочник недоступен. Используются резервные условия; подтвердите их перед оформлением.';legal.appendChild(warning);}}
    finally{clearTimeout(timer);}
  })();
})();
