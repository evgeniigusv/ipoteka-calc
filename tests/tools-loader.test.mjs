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
