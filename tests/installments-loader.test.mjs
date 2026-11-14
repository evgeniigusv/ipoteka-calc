import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/installments-loader.js',import.meta.url),'utf8');
const snapshot=JSON.parse(fs.readFileSync(new URL('../assets/installments.json',import.meta.url),'utf8'));
const historical=JSON.parse(fs.readFileSync(new URL('./fixtures/installments-october.json',import.meta.url),'utf8'));
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../assets/data.js',import.meta.url),'utf8'),context);
const builtIn=JSON.parse(JSON.stringify(context.window.SM_DATA.installments));
assert.deepEqual(builtIn.filter(p=>p.projects[0].startsWith('ДА —')),snapshot.programs);
async function load(data,fail=false){
 const backup=builtIn;
 const window={SM_DATA:{installments:backup}};
 vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
   assert.equal(url,'assets/installments.json');assert.equal(options.cache,'no-store');
   if(fail)throw new Error('Нет сети');return {ok:true,json:async()=>data};
 }});
 await window.SM_INSTALLMENTS_READY;return {window,backup};
}
let result=await load({...snapshot,checked_at:new Date().toISOString()});
assert.deepEqual(result.window.SM_DATA.installments,builtIn);
assert.equal(result.window.SM_INSTALLMENTS_STATUS.fallback,false);
assert.equal(result.window.SM_INSTALLMENTS_STATUS.stale,false);
for(const data of [null,historical,{...snapshot,programs:[]}, {...snapshot,programs:snapshot.programs.map((p,i)=>i===0?{...p,end:'2027-02-30'}:p)},
 {...snapshot,programs:snapshot.programs.map((p,i)=>i===1?{...p,pay:{1:-1,2:0,3:0}}:p)},
 {...snapshot,programs:snapshot.programs.map((p,i)=>i===2?{...p,discFromPv:.13}:p)},
 {...snapshot,programs:snapshot.programs.map((p,i)=>i===2?{...p,end:null,months:24}:p)},
 {...snapshot,programs:snapshot.programs.map((p,i)=>i===1?historical.programs[2]:p)},
 {...snapshot,programs:snapshot.programs.map(p=>({...p,projects:['ДА — 1 очередь']}))}]){
 result=await load(data);assert.equal(result.window.SM_DATA.installments,result.backup);assert.equal(result.window.SM_INSTALLMENTS_STATUS.fallback,true);
}
result=await load(snapshot,true);assert.equal(result.window.SM_DATA.installments,result.backup);
result=await load({...snapshot,checked_at:'2020-01-01T00:00:00+05:00'});assert.equal(result.window.SM_INSTALLMENTS_STATUS.stale,true);
console.log('Загрузка рассрочек: снимок, резерв, давность и отдельные условия ДНК — проверены');
