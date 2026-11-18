import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import M from '../assets/tools-model.js';
const source=fs.readFileSync('assets/tools-loader.js','utf8'),data=JSON.parse(fs.readFileSync('tests/fixtures/tools-initial.json','utf8'));
async function run(payload,ok=true){const old={legacy:true};const context={window:{SM_DATA:{mortgage:old},SMToolsModel:M},location:{hostname:'example.org',port:''},AbortController,Date,setTimeout,clearTimeout,document:{querySelector:()=>null},fetch:async()=>({ok,json:async()=>payload})};vm.createContext(context);vm.runInContext(source,context);await context.window.SM_TOOLS_READY;return context.window;}
let r=await run(data);assert.equal(r.SM_DATA.mortgage.length,M.calcData(data).mortgage.length);assert.equal(r.SM_TOOLS_STATUS.fallback,false);
r=await run({},false);assert.equal(r.SM_DATA.mortgage.legacy,true);assert.equal(r.SM_TOOLS_STATUS.fallback,true);
r=await run({...data,checked_at:'не дата'});assert.equal(r.SM_DATA.mortgage.legacy,true);assert.equal(r.SM_TOOLS_STATUS.fallback,true);
let resolveOld;const delayed=new Promise(res=>resolveOld=res),ctx={window:{SM_DATA:{},SMToolsModel:M,SM_MORTGAGE_READY:delayed},location:{hostname:'example.org',port:''},AbortController,Date,setTimeout,clearTimeout,document:{querySelector:()=>null},fetch:async()=>({ok:true,json:async()=>data})};vm.createContext(ctx);vm.runInContext(source,ctx);ctx.window.SM_DATA.mortgage=['old'];resolveOld();await ctx.window.SM_TOOLS_READY;assert.equal(ctx.window.SM_DATA.mortgage.length,M.calcData(data).mortgage.length);
console.log('Единый загрузчик: снимок, резерв, дата и порядок завершения старых загрузчиков проверены.');

// Просроченная сессия должна объяснять сбой, не маскировать его общей ошибкой.
const localContext={window:{SM_DATA:{},SMToolsModel:M},location:{hostname:'127.0.0.1',port:'8795'},AbortController,Date,setTimeout,clearTimeout,document:{querySelector:()=>null},fetch:async path=>path==='/api/session'?{ok:true,json:async()=>({csrf:'qa'})}:{ok:false,status:401}};
vm.createContext(localContext);vm.runInContext(source,localContext);await localContext.window.SM_TOOLS_READY;
assert.match(localContext.window.SM_TOOLS_STATUS.error,/401.*Сессия устарела/);
assert.equal(localContext.window.SM_TOOLS_DATA,undefined);

function page({hostname='example.org',port='',partner=false,fetch,legacy}){
  const context=vm.createContext({
    window:{SM_DATA:{},SMToolsModel:M,SM_TOOLS_PARTNER_VIEW:partner,SM_MORTGAGE_READY:legacy},
    location:{hostname,port},document:{querySelector:()=>null},
    AbortController,Date,setTimeout,clearTimeout,fetch
  });
  return {
    window:context.window,
    load(early=false){
      context.document.currentScript={hasAttribute:name=>early&&name==='data-tools-preload'};
      vm.runInContext(source,context);
    }
  };
}
const reply=payload=>({ok:true,json:async()=>payload});
const publicCalls=[];
let current=data;
function publicFetch(url,options){
  publicCalls.push(url);
  assert.equal(url,'assets/tools.json');
  assert.equal(options.cache,'no-cache');
  assert.equal(options.credentials,'omit');
  assert.equal(options.headers,undefined);
  return Promise.resolve(reply(current));
}
// Ранний и основной теги в любом порядке делают один запрос на документ.
for(const order of [[true,true,false],[false,true]]){
  const count=publicCalls.length;
  const partner=page({fetch:publicFetch});
  for(const early of order)partner.load(early);
  await partner.window.SM_TOOLS_READY;
  assert.equal(publicCalls.length,count+1);
  assert.equal(partner.window.SM_TOOLS_DATA.checked_at,current.checked_at);
  current={...data,checked_at:'2026-11-18T12:00:00Z'};
}

// На origin редактора ранний тег не читает ни сессию, ни каталог. Только основной
// тег знает режим страницы и может отправить токен на /api/tools.
for(const partner of [true,false]){
  const calls=[];
  const editor=page({hostname:'127.0.0.1',port:'8795',partner,fetch:async(url,options)=>{
    calls.push(url);
    if(partner)return publicFetch(url,options);
    assert.equal(options.cache,'no-store');
    if(url==='/api/session')return reply({csrf:'test-token'});
    assert.equal(options.headers['X-Editor-Session'],'test-token');
    return reply({...data,revision:'private-test-revision'});
  }});
  editor.load(true);
  assert.deepEqual(calls,[]);
  editor.load();
  await editor.window.SM_TOOLS_READY;
  assert.deepEqual(calls,partner?['assets/tools.json']:['/api/session','/api/tools']);
  assert.equal(editor.window.SM_TOOLS_STATUS.local,!partner);
  assert.equal(editor.window.SM_PUBLIC_TOOLS_REQUEST,undefined);
}

// Проверка может начаться сразу. И успешный результат, и резерв дожидаются
// старых загрузчиков, иначе они могли бы затереть ставки после SM_TOOLS_READY.
for(const ok of [true,false]){
  let finish,started=false,ready=false;
  const legacy=new Promise(resolve=>{finish=resolve;});
  const p=page({legacy,fetch:async()=>{
    started=true;
    if(!ok)throw new Error('Нет сети');
    return reply(data);
  }});
  p.load(true);
  await new Promise(resolve=>setImmediate(resolve));
  p.load();
  p.window.SM_TOOLS_READY.then(()=>{ready=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,true);
  assert.equal(ready,false);
  p.window.SM_DATA.mortgage=['legacy'];
  finish();
  await p.window.SM_TOOLS_READY;
  assert.equal(p.window.SM_TOOLS_STATUS.fallback,!ok);
  if(!ok)assert.deepEqual(p.window.SM_DATA.mortgage,['legacy']);
}

// Настоящие скрипты в порядке defer: публичный каталог, затем резерв этой страницы.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {resolve,promise};
}
for(const [kind,readyKey,statusKey] of [
  ['mortgage','SM_MORTGAGE_READY','SM_MORTGAGE_STATUS'],
  ['installments','SM_INSTALLMENTS_READY','SM_INSTALLMENTS_STATUS']
]){
  const loader=fs.readFileSync('assets/'+kind+'-loader.js','utf8');
  const updated=new Date().toISOString(),old='2020-01-01T00:00:00Z';
  const catalogData={...data,checked_at:updated,full_checked_at:old,
    mortgageCheckedAt:{da1:old,da2:updated,dnk2:updated},mortgageWarnings:{da1:'Ошибка источника'}};
  const backup=JSON.parse(fs.readFileSync('assets/'+kind+'.json','utf8'));
  backup.checked_at=old;
  for(const scenario of ['catalog','invalid','offline-before-backup-script']){
    const catalog=gate(),snapshot=gate(),events=new EventTarget(),calls=[];
    const warning=[];
    const window={SM_DATA:{mortgage:[],installments:[]},SMToolsModel:M,addEventListener:()=>{}};
    const document={
      readyState:'interactive',addEventListener:events.addEventListener.bind(events),
      querySelector:()=>({appendChild:el=>warning.push(el.textContent)}),createElement:()=>({})
    };
    const ctx=vm.createContext({window,document,location:{hostname:'example.org',port:''},AbortController,Date,setTimeout,clearTimeout,
      fetch:(url,options)=>{
        calls.push([url,options.cache]);
        if(url==='assets/tools.json')return catalog.promise;
        assert.equal(url,'assets/'+kind+'.json');
        return snapshot.promise;
      }
    });
    vm.runInContext(source,ctx);
    let ready=false;
    window.SM_TOOLS_READY.then(()=>{ready=true;});
    if(scenario==='offline-before-backup-script'){
      catalog.resolve({ok:false,status:503});
      await tick();
      assert.equal(ready,false);
    }
    vm.runInContext(loader,ctx);
    vm.runInContext(loader,ctx);
    events.dispatchEvent(new Event('DOMContentLoaded'));
    if(scenario!=='offline-before-backup-script'){
      await tick();
      assert.deepEqual(calls,[['assets/tools.json','no-cache']]);
      catalog.resolve(reply(scenario==='invalid'?{}:catalogData));
    }
    await tick();
    if(scenario==='catalog'){
      assert.equal(ready,true);
      await window[readyKey];
      assert.equal(window.SM_TOOLS_STATUS.fallback,false);
      assert.deepEqual(calls,[['assets/tools.json','no-cache']]);
      assert.deepEqual(warning,[]);
      const da1=window.SM_MORTGAGE_STATUS.byProject[M.projects.da1];
      assert.equal(da1.stale,true);
      assert.equal(da1.fallback,true);
      assert.match(da1.message,/Ошибка источника/);
      assert.equal(window.SM_MORTGAGE_STATUS.byProject[M.projects.da2].stale,false);
      assert.equal(window.SM_INSTALLMENTS_STATUS.stale,true);
    }else{
      assert.equal(ready,false);
      assert.deepEqual(calls,[['assets/tools.json','no-cache'],['assets/'+kind+'.json','no-store']]);
      snapshot.resolve(reply(backup));
      await Promise.all([window.SM_TOOLS_READY,window[readyKey]]);
      assert.equal(window.SM_TOOLS_STATUS.fallback,true);
      assert.equal(window[statusKey].stale,true);
      assert.equal(window[statusKey].fallback,false);
      assert.equal(window.SM_DATA[kind].length,backup.programs.length);
      assert.match(warning.join(' '),/резервные условия/);
    }
  }
}
