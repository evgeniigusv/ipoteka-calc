import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const text = 'Не является публичной офертой. Окончательные расчёты уточнять у менеджера отдела продаж.';
const renders = [], instances = [], nodes = new Map(), events = {};
class Element {
  constructor() { this.style = {}; this.classList = { contains: () => false }; this.offsetHeight = 0; }
  appendChild(node) { this.child = node; if (node.id) nodes.set(node.id, node); }
  remove() { if (this.id) nodes.delete(this.id); }
}
class Pdf {
  constructor() { this.pages = [[]]; instances.push(this); }
  addPage() { this.pages.push([]); }
  setFillColor() {}
  rect() {}
  addImage(...args) { this.pages.at(-1).push(args); }
}
const context = {
  document: { createElement: () => new Element(), getElementById: id => nodes.get(id), head: new Element(), body: new Element(), fonts: { ready: Promise.resolve() } },
  Image: class { set src(value) { this.onerror(); } },
  window: { CSSMarginRule: class {}, addEventListener(name, fn) { events[name] = fn; }, SMCalc: { fmt: {} }, jspdf: { jsPDF: Pdf }, html2canvas: async (node, options) => {
    renders.push({ node, options });
    return { width: options.width * 2, height: options.height * 2, toDataURL: () => node.className === 'sm-pdf-disclaimer' ? 'footer' : 'calculation' };
  } }
};
vm.runInNewContext(fs.readFileSync(new URL('../assets/common.js', import.meta.url), 'utf8'), context);
for (const [orientation, width, height] of [['portrait', 210, 297], ['landscape', 297, 210]]) {
  const short = new Element(), tall = new Element(); tall.offsetHeight = 2400;
  const result = await context.window.SMUi.makePdf(() => ({ pages: [short, tall], file: 'Расчёт' }), orientation);
  assert.equal(result.file, 'Расчёт.pdf');
  assert.equal(result.canvases.length, 2);
  const pdf = instances.at(-1);
  assert.equal(pdf.pages.length, 2);
  for (const [content, footer] of pdf.pages) {
    assert.equal(content[0], 'calculation'); assert.equal(footer[0], 'footer');
    const [, , x, y, w, h] = content, [, , fx, fy, fw, fh] = footer;
    assert.ok(y + h <= fy - 1, 'Расчёты не перекрывают дисклеймер, даже на высоком листе');
    assert.ok(x >= 0 && x + w <= width + 1e-9);
    assert.ok(fx >= 0 && fx + fw <= width + 1e-9);
    assert.ok(fy >= height - 18 && fy + fh <= height - 2 + 1e-9, 'Нижняя полоса и отступ от края');
  }
}
const footers = renders.filter(r => r.node.className === 'sm-pdf-disclaimer');
assert.equal(footers.length, 2);
for (const footer of footers) {
  assert.equal(footer.node.textContent, text);
  assert.match(footer.node.style.cssText, /14px\/1.4/);
}
events.beforeprint();
const printFooter = nodes.get('sm-print-disclaimer'), printStyle = nodes.get('sm-print-disclaimer-style');
assert.equal(printFooter.textContent, text);
assert.match(printStyle.textContent, /@page\{margin:12mm 12mm 24mm;/, 'Поле страницы резервирует место под колонтитул');
assert.ok(printStyle.textContent.includes('@bottom-center{content:' + JSON.stringify(text)), 'Точный текст в нативном поле каждой страницы');
assert.match(printStyle.textContent, /html body\.tools > #sm-print-disclaimer/, 'Колонтитул не скрывается стилями печати инструментов');
events.beforeprint(); assert.equal(nodes.get('sm-print-disclaimer'), printFooter, 'Повторное событие не создаёт второй колонтитул');
events.afterprint(); assert.equal(nodes.has('sm-print-disclaimer'), false);
events.beforeprint(); assert.equal(nodes.get('sm-print-disclaimer').textContent, text);
assert.equal(nodes.get('sm-print-disclaimer-style'), printStyle);
events.afterprint();
nodes.delete('sm-print-disclaimer-style'); delete context.window.CSSMarginRule;
events.beforeprint();
assert.ok(!nodes.get('sm-print-disclaimer-style').textContent.includes('@bottom-center'));
assert.match(nodes.get('sm-print-disclaimer-style').textContent, /display:block!important;position:static;break-inside:avoid/, 'Без поддержки полей страниц — отдельный блок в конце документа, без наложения');
events.afterprint();
console.log('PDF: точный дисклеймер на каждом листе, кириллица, обе ориентации, длинный расчёт без перекрытия — проверены');
console.log('Печать браузером: общий колонтитул, резерв нижнего поля, повторная печать и очистка — проверены');
