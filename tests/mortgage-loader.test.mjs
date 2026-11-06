import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/mortgage-loader.js',import.meta.url),'utf8');
const snapshot=JSON.parse(fs.readFileSync(new URL('../assets/mortgage.json',import.meta.url),'utf8'));
async function load(data,fail=false){
  const backup=[{fallback:true}],window={SM_DATA:{mortgage:backup}};
  const ctx={window,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
    assert.equal(url,'assets/mortgage.json');assert.equal(options.cache,'no-store');
    if(fail)throw new Error('Сеть недоступна');return {ok:true,json:async()=>data};
  }};
  vm.runInNewContext(source,ctx);await window.SM_MORTGAGE_READY;return {window,backup};
}
let result=await load({...snapshot,checked_at:new Date().toISOString()});
assert.equal(result.window.SM_DATA.mortgage.length,snapshot.programs.length);
assert.equal(result.window.SM_MORTGAGE_STATUS.fallback,false);
assert.equal(result.window.SM_MORTGAGE_STATUS.stale,false);
for(const data of [null,{...snapshot,programs:[]},{...snapshot,programs:snapshot.programs.filter(p=>!p.projects.includes('ДНК — 2 очередь'))},{...snapshot,programs:snapshot.programs.map((p,i)=>i===0?{...p,subsidy:null}:p)}]){
  result=await load(data);assert.equal(result.window.SM_DATA.mortgage,result.backup);assert.equal(result.window.SM_MORTGAGE_STATUS.fallback,true);
}
result=await load(snapshot,true);assert.equal(result.window.SM_DATA.mortgage,result.backup);
result=await load({...snapshot,checked_at:'2020-01-01T00:00:00+05:00'});assert.equal(result.window.SM_MORTGAGE_STATUS.stale,true);
console.log('Загрузка ставок: свежий снимок, устаревание, оба проекта, резерв при ошибке — проверены');
