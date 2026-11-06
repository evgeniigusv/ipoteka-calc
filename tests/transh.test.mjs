import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
globalThis.window=globalThis;
vm.runInThisContext(fs.readFileSync(new URL('../assets/engine.js',import.meta.url),'utf8'));
vm.runInThisContext(fs.readFileSync(new URL('../assets/transh-engine.js',import.meta.url),'utf8'));
const x={price:10000000,down:.2,rate:.192,years:30,first:.2,second:.3,date1:'2026-11-06',date2:'2027-11-06',date3:'2029-05-01',minFirst:0};
const r=SMTranshCalc.calculate(x);
assert.equal(r.down,2000000);assert.equal(r.total,8000000);
assert.deepEqual(r.stages.map(s=>s.amount),[2000000,3000000,3000000]);
assert.deepEqual(r.stages.map(s=>s.issued),[2000000,5000000,8000000]);
r.stages.forEach(s=>assert.ok(Math.abs(s.payment-SMCalc.pmt(.192/12,360,s.issued))<.001));
const min=SMTranshCalc.calculate({...x,price:6000000,first:.01,second:.2,minFirst:100000});
assert.equal(min.stages[0].amount,100000);assert.equal(min.stages.reduce((a,s)=>a+s.amount,0),min.total);
assert.throws(()=>SMTranshCalc.calculate({...x,down:.1}),/от 20%/);
assert.throws(()=>SMTranshCalc.calculate({...x,first:.6,second:.3}),/остаток/);
assert.throws(()=>SMTranshCalc.calculate({...x,date3:'2027-01-01'}),/даты/);
assert.throws(()=>SMTranshCalc.calculate({...x,date3:'2057-01-01'}),/окончания/);
console.log('Транши 2 → 5 → 8 млн, минимум 100 тыс., валидация дат и суммы проверены');
const da=SMTranshCalc.calculate({...x,down:.201,tranches:2,firstRub:100000,date2:'2028-09-20',date3:''});
assert.equal(da.total,7990000); assert.equal(da.stages.length,2);
assert.deepEqual(da.stages.map(s=>s.amount),[100000,7890000]);
assert.deepEqual(da.stages.map(s=>s.issued),[100000,7990000]);
assert.ok(Math.abs(da.stages[0].payment-SMCalc.pmt(.192/12,360,100000))<.001);
assert.throws(()=>SMTranshCalc.calculate({...x,tranches:2,firstRub:8000000,date3:''}),/меньше суммы кредита/);
assert.throws(()=>SMTranshCalc.calculate({...x,tranches:2,firstRub:100000,date2:'',date3:''}),/дату/);
console.log('ДА: первый транш 100 тыс., второй — весь остаток, проверены');
// User-approved preliminary DA scenario: 100,000 RUB issued, ~1,500/month on 30 years.
const referenceRate=SMTranshCalc.rateFromPayment(100000,1500,30);
assert.ok(referenceRate>.17 && referenceRate<.19);
for(const date2 of ['2027-03-20','2028-09-20']){
  const reference=SMTranshCalc.calculate({...x,rate:referenceRate,down:.201,tranches:2,firstRub:100000,date2,date3:''});
  assert.ok(Math.abs(reference.stages[0].payment-1500)<1e-8);
  assert.ok(Math.abs(reference.stages[1].payment-119850)<1e-6);
  assert.deepEqual(reference.stages.map(s=>s.amount),[100000,7890000]);
  assert.equal(reference.stages.reduce((sum,s)=>sum+s.amount,0)+reference.down,reference.price);
}
const shorter=SMTranshCalc.calculate({...x,rate:referenceRate,years:20,down:.201,tranches:2,firstRub:100000,date2:'2028-09-20',date3:''});
assert.ok(shorter.stages[0].payment>1500); // Changing term changes payments, not the inferred annual rate.
assert.ok(Math.abs(shorter.stages[1].payment/shorter.stages[0].payment-79.9)<1e-10);
assert.throws(()=>SMTranshCalc.rateFromPayment(100000,250,30),/не покрывает/);
assert.throws(()=>SMTranshCalc.rateFromPayment(Infinity,1500,30),/Некорректный/);
console.log('Ориентир ДА: 1 500 ₽ → 119 850 ₽ для 10 млн, обе очереди и сокращённый срок — проверены');
