import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(new URL('../assets/engine.js', import.meta.url), 'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('../assets/chpv-engine.js', import.meta.url), 'utf8'));
const x = {base: 6939080.459770115, cash: 6037000, client: 200000, ddu: 7745000, minDown: .201, cost: .25, limit: 10000000, years: 15, rate: .06, overRate: .14};
const r = SMChpvCalc.calculate(x);
const near = (a,b) => assert.ok(Math.abs(a-b)<.02, `${a} != ${b}`);
near(r.minimum,1394755.1724); near(r.down,1556745); near(r.funded,1356745); near(r.cost,339186.25); near(r.profit,-12068.75); near(r.loan,6188255); near(r.payment,52220.01235);
assert.equal(r.verdict, 'Подходит');
const s = SMChpvCalc.suggested(x); assert.ok(SMChpvCalc.calculate({...x,ddu:s}).profit <= 1000); assert.ok(SMChpvCalc.calculate({...x,ddu:s-1000}).profit > 1000);
const combo = SMChpvCalc.calculate({...x,limit:6000000}); assert.equal(combo.verdict, 'Комбо-ипотека'); assert.equal(combo.rate,.14);
console.log('ЧПВ совпадает с примером таблицы; подбор цены и сверхлимит проверены');

assert.throws(()=>SMChpvCalc.calculate({...x,client:2000000}),/Субсидирование ПВ не требуется/);
assert.throws(()=>SMChpvCalc.calculate({...x,ddu:0}),/Проверьте/);

// Подбор не выдаёт ДДУ, который тот же калькулятор отклоняет.
assert.equal(SMChpvCalc.suggested({...x,base:10000000,cash:9000000,client:2000000}),null);
assert.equal(SMChpvCalc.suggested({...x,cost:undefined}),null);
for(const client of [0,100000,500000,1000000,2000000]){
 const candidate={...x,base:10000000,cash:9000000,client};
 const suggested=SMChpvCalc.suggested(candidate);
 if(suggested!=null){const result=SMChpvCalc.calculate({...candidate,ddu:suggested});assert.ok(result.funded>=0);assert.ok(result.profit<=1000);}
}
