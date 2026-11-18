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
  async function fetchCatalog(local){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),local?120000:15000);
    try{
      // При каждом открытии браузер сверяет публичный снимок с сервером по ETag или дате.
      let path='assets/tools.json';
      let options={cache:'no-cache',credentials:'omit',priority:'high',signal:controller.signal};
      if(local){
        const session=await fetch('/api/session',{cache:'no-store',signal:controller.signal});
        if(!session.ok)throw new Error('Сессия редактора недоступна (HTTP '+session.status+').');
        window.SM_TOOLS_SESSION=await session.json();
        path='/api/tools';
        options={cache:'no-store',headers:{'X-Editor-Session':window.SM_TOOLS_SESSION.csrf},signal:controller.signal};
      }
      const response=await fetch(path,options);
      if(!response.ok)throw new Error('Каталог не ответил (HTTP '+response.status+'). '+(response.status===401?'Сессия устарела. Откройте редактор заново.':''));
      return await response.json();
    }finally{
      clearTimeout(timer);
    }
  }
  const editorOrigin=location.hostname==='127.0.0.1'&&location.port==='8795';
  // Необязательный async-скрипт в head запускает только публичную перепроверку.
  // На origin редактора режим партнёра определяется позже, в самой странице.
  if(document.currentScript?.hasAttribute('data-tools-preload')){
    if(!editorOrigin&&!window.SM_TOOLS_READY&&!window.SM_PUBLIC_TOOLS_REQUEST){
      window.SM_PUBLIC_TOOLS_REQUEST=fetchCatalog(false);
      // Основной скрипт обработает ошибку, даже если запрос завершился до его загрузки.
      window.SM_PUBLIC_TOOLS_REQUEST.catch(()=>{});
    }
    return;
  }
  if(window.SM_TOOLS_READY)return;
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
  function snapshotLoaders(){
    return [window.SM_MORTGAGE_READY,window.SM_INSTALLMENTS_READY].filter(Boolean);
  }
  // При отказе каталога ждём в том числе резервный скрипт, стоящий ниже в HTML.
  // Подписываемся до запроса, чтобы не пропустить DOMContentLoaded во время загрузки.
  const parsed=document.readyState==='loading' || document.readyState==='interactive'
    ? new Promise(resolve=>{
        document.addEventListener('DOMContentLoaded',resolve,{once:true});
        window.addEventListener('load',resolve,{once:true});
      })
    : undefined;
  window.SM_TOOLS_PRIMARY_READY=(async function(){
    const local=editorOrigin&&!window.SM_TOOLS_PARTNER_VIEW;
    const request=(!editorOrigin&&window.SM_PUBLIC_TOOLS_REQUEST)||fetchCatalog(local);
    delete window.SM_PUBLIC_TOOLS_REQUEST;
    // Старый автономный загрузчик уже пишет в SM_DATA. Его запись должна закончиться первой.
    const [catalog]=await Promise.allSettled([request,...snapshotLoaders()]);
    try{
      if(catalog.status==='rejected')throw catalog.reason;
      var data=window.SMToolsModel.validate(catalog.value),calc=window.SMToolsModel.calcData(data);
      if(!Number.isFinite(Date.parse(data.checked_at)))throw new Error('Не указана дата проверки справочника');
      window.SM_TOOLS_DATA=data;window.SM_TOOLS_STATUS={fallback:false,checkedAt:Date.parse(data.checked_at),local:local};
      if(window.SM_DATA){window.SM_DATA.mortgage=calc.mortgage;window.SM_DATA.installments=calc.installments;window.SM_DATA.tranche=calc.tranche;window.SM_DATA.chpv=calc.chpv;window.SM_DATA.cashDiscounts=calc.cashDiscounts;window.SM_DATA.settings=calc.settings;window.SM_DATA.promotions=calc.promotions;}
      var byProject={};
      Object.entries(window.SMToolsModel.projects).forEach(function(pair){
        byProject[pair[1]]=mortgageStatus(data,pair[0]);
      });
      window.SM_MORTGAGE_STATUS={byProject:byProject,checkedAt:Date.parse(data.checked_at),stale:Date.now()-Date.parse(data.checked_at)>12*3600000,fallback:false};
      window.SM_INSTALLMENTS_STATUS={checkedAt:Date.parse(data.full_checked_at||data.checked_at),stale:Date.now()-Date.parse(data.full_checked_at||data.checked_at)>8*86400000,fallback:false,catalog:true};
      return true;
    }catch(e){
      window.SM_TOOLS_STATUS={fallback:true,error:e.message};
      const legal=document.querySelector('.sm-foot .sm-legal');
      if(legal){
        const warning=document.createElement('span');
        warning.className='sm-why';
        warning.textContent=' Единый справочник недоступен. Используются резервные условия; подтвердите их перед оформлением.';
        legal.appendChild(warning);
      }
      return false;
    }
  })();
  window.SM_TOOLS_READY=(async function(){
    if(await window.SM_TOOLS_PRIMARY_READY)return;
    await parsed;
    await Promise.allSettled(snapshotLoaders());
  })();
})();
