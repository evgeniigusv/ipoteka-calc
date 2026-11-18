import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import M from '../assets/tools-model.js';
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

const legacy = JSON.parse(fs.readFileSync(new URL('./fixtures/tools-initial.json', import.meta.url)));
const current = M.validate(legacy);
assert.deepEqual(current.settings.moneyCost, {da1:.25, da2:.5, dnk2:null});
const oldProgram = legacy.records.find(row => row.kind === 'chpv' && row.project === 'da1');
assert.equal(oldProgram.params.cost, .25);
assert.ok(!M.fields.chpv.some(field => field.key === 'cost'));
const da1 = current.records.find(row => row.id === oldProgram.id);
assert.ok(!('cost' in da1.params));
da1.enabled = false;
current.records.push({...da1, id:'new-chpv', enabled:true});
for (const cost of [0, .375, .99]) {
  current.settings.moneyCost.da1 = cost;
  const programs = M.calcData(current).chpv;
  assert.ok(!programs.some(p => p.catalogId === da1.id));
  assert.ok(programs.some(p => p.catalogId === 'new-chpv'));
  for (const p of programs) {
    const expected = p.projects.includes(M.projects.da1) ? cost : .5;
    assert.equal(p.cost, expected);
    const input = {...x, cost:p.cost};
    near(SMChpvCalc.calculate(input).cost, r.funded * expected);
    const suggested = SMChpvCalc.suggested(input);
    assert.ok(suggested > 0);
    assert.ok(SMChpvCalc.calculate({...input, ddu:suggested}).profit <= 1000);
    assert.ok(SMChpvCalc.calculate({...input, ddu:suggested-1000}).profit > 1000);
  }
}
for (const cost of [undefined, null, '0', -.1, 1, Infinity]) {
  assert.throws(() => SMChpvCalc.calculate({...x, cost}), /стоимость денег/);
  assert.equal(SMChpvCalc.suggested({...x, cost}), null);
}
