import io
import json
import wave
import sys
import threading
import subprocess
import sqlite3
import tempfile
from contextlib import closing
import unittest
from copy import deepcopy
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation'))
import tools_ai as ai
import tools_editor as editor
import tools_proposals as proposals
import tools_source as source
import owner_catalog

TEXT = ('Протокол встречи. Решили: для ДА, первая очередь, ввести рассрочку «Пробный график». '
        'Первоначальный взнос 40% от стоимости, остаток одним платежом через четыре месяца от сделки. '
        'Скидка не применяется, с акциями не суммируется. '
        'Предложение снизить ставку до 1% обсуждалось, решения нет.')
DATA = json.loads((source.ROOT/'tests/fixtures/tools-initial.json').read_text())
DATA['revision'] = source.revision(DATA['records'])
ITEM = dict(target='', name='Пробный график', project='da1', kind='installment', category='installment',
            terms='Первоначальный взнос 40%. Остаток через 4 месяца. Скидка 0%.',
            combination='С акциями не суммируется.', source_ids=[2, 3, 4])
EDITS = [dict(field=k, value_json=json.dumps(v), quote=q) for k,v,q in [
    ('minPv', .4, 'взнос 40%'), ('months', 4, 'через 4 месяца'), ('scheme', 'deferred', 'Остаток через 4 месяца'),
    ('disc', 0, 'Скидка 0%')]]


class PlanTest(unittest.TestCase):
    def test_original_payment_sequence_grounds_plan_and_keeps_other_settings(self):
        data = deepcopy(DATA)
        old = next(r for r in data['records'] if r['kind']=='installment')
        old['params'].update(scheme='monthly',pay={'1':50000,'2':75000,'3':100000})
        before = deepcopy(old)
        text = 'Измени ежемесячные платежи с 50–75–100 тысяч рублей на 30–60–90 тысяч рублей'
        item = dict(ITEM, target=old['id'],name='Придуманное название', project=old['project'],
                    terms='Платежи 30, 60 и 90 тысяч рублей.',combination='',source_ids=[1])
        for amounts in ((30,60,90),(30000,60000,90000)):
            edits = [dict(field='pay.'+str(i),value_json=str(v),quote=text) for i,v in enumerate(amounts,1)]
            with patch.object(proposals,'structured',return_value={'items':[item],'questions':[]}) as planner, \
                    patch.object(ai,'generate',return_value={'question':'','edits':edits}):
                result = proposals.proposals(data,text)
            catalog = next(r for r in planner.call_args.args[1]['catalog'] if r['id']==old['id'])
            self.assertEqual(catalog['params'],before['params'])
            self.assertEqual(catalog['mode'],before['mode'])
            if amounts[0]==30:
                self.assertFalse(result['items'])
                self.assertTrue(result['questions'])
            else:
                self.assertFalse(result['questions'])
                card, = result['items']
                self.assertEqual(card['record']['name'],before['name'])
                self.assertEqual(card['record']['params'],dict(before['params'],pay={'1':30000,'2':60000,'3':90000}))
                self.assertEqual(card['quotes'],[text])
        self.assertEqual(old,before)

    def test_rewritten_terms_cannot_invent_units_or_change_discount(self):
        data = deepcopy(DATA)
        old = next(r for r in data['records'] if r['kind']=='installment')
        old['params'].update(scheme='monthly',pay={'1':50000,'2':75000,'3':100000})
        for text, field, value, terms in [
                ('Платёж для студии теперь 30','pay.1',30000,'Платёж 30 тысяч рублей'),
                ('Платёж для студии теперь 30 тысяч рублей','disc',.3,'Скидка 30%'),
                ('Платёж для студии теперь 30 тысяч рублей','mode','none','Не суммируется с акциями'),
                ('Платёж для студии теперь 30 тысяч рублей','minPv',None,'Убрать первоначальный взнос')]:
            item = dict(ITEM,target=old['id'],project=old['project'],name=old['name'],terms=terms,combination='',source_ids=[1])
            with self.subTest(field=field), patch.object(proposals,'structured',return_value={'items':[item],'questions':[]}), \
                    patch.object(ai,'generate',return_value={'question':'','edits':[dict(field=field,value_json=json.dumps(value),quote=terms)]}):
                result = proposals.proposals(data,text)
            self.assertFalse(result['items'])
            self.assertTrue(result['questions'])

    def test_original_evidence_and_calculation(self):
        with patch.object(proposals, 'structured', return_value={'items':[dict(ITEM,name='Рассрочка')], 'questions':[]}) as plan, \
             patch.object(ai, 'generate', return_value={'question':'','edits':EDITS}):
            result = proposals.proposals(DATA, TEXT)
        fragments = plan.call_args.args[1]['document']
        self.assertEqual(fragments[-1]['id'], 5)
        self.assertFalse(result['questions'])
        card, = result['items']
        self.assertEqual(card['quotes'], [s['text'] for s in fragments[1:4]])
        self.assertTrue(all(q in TEXT for q in card['quotes']))
        self.assertEqual(card['record']['name'], 'Пробный график')
        self.assertEqual(card['record']['params'], dict(minPv=.4, months=4, scheme='deferred', disc=0))
        self.assertEqual(card['record']['mode'], 'none')

    def test_bad_reference_never_becomes_a_card(self):
        for ids in ([], [0], [-1], [6], [True], ['2']):
            with self.subTest(ids=ids), patch.object(proposals, 'structured', return_value={
                    'items':[dict(ITEM,source_ids=ids)],'questions':[]}), patch.object(ai, 'generate') as generate:
                result = proposals.proposals(DATA, TEXT)
                self.assertFalse(result['items'])
                self.assertTrue(result['questions'])
                generate.assert_not_called()

    def test_audio_request_carries_original_file_and_glossary(self):
        with io.BytesIO() as buf:
            with wave.open(buf, 'wb') as wav:
                wav.setparams((1, 2, 16000, 0, 'NONE', ''))
                wav.writeframes(bytes(3200))
            raw = buf.getvalue()

        def receive(args, **kwargs):
            self.assertEqual(Path(args[-1].removeprefix('file=@')).read_bytes(), raw)
            prompt = next(a for a in args if a.startswith('prompt='))
            for term in ('«ДА»', 'ДНК-2', 'рассрочка', 'отсрочка', 'ПВ'):
                self.assertIn(term, prompt)
            return proposals.subprocess.CompletedProcess(args, 0, '{"text":"Проверено"}')

        with patch.object(proposals, 'api_key', return_value='test'), patch.object(
                proposals.subprocess, 'run', side_effect=receive):
            self.assertEqual(proposals.transcribe(raw, 'audio/wav'), 'Проверено')


class BatchTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'catalog.sqlite'
        initial = dict(deepcopy(DATA), settings=deepcopy(owner_catalog.DEFAULT_SETTINGS))
        with closing(sqlite3.connect(self.path)) as db:
            db.executescript('CREATE TABLE catalog(id INTEGER PRIMARY KEY, data TEXT NOT NULL, revision TEXT NOT NULL, generation INTEGER NOT NULL); CREATE TABLE requests(request_key TEXT PRIMARY KEY, revision TEXT NOT NULL, created_at TEXT NOT NULL);')
            db.execute('INSERT INTO catalog VALUES(1,?,?,1)', (json.dumps(initial), initial['revision']))
            db.commit()
        self.enter_patch(owner_catalog, 'catalog_path', return_value=self.path)
        self.enter_patch(owner_catalog, 'backups', return_value=None)
        self.data = owner_catalog.read(True)
        self.server = editor.ThreadingHTTPServer(('127.0.0.1', 0), editor.Handler)
        port = self.server.server_port
        self.origin = f'http://127.0.0.1:{port}'
        self.connection = HTTPConnection('127.0.0.1', port, timeout=10)
        for obj, name, value in [
                (editor, 'PORT', port), (editor, 'ORIGIN', self.origin),
                (source, 'config', lambda:{'sheet_name':'test'}),
                (editor, 'read', owner_catalog.read),
                (editor, 'read_catalog', lambda:owner_catalog.read(True)),
                (editor, 'with_subsidies', lambda data:data)]:
            self.enter_patch(obj, name, new=value)
        self.google = self.enter_patch(source, 'google', side_effect=AssertionError('Google запрещён в тесте'))
        self.publish = self.enter_patch(editor, 'publish', return_value='local')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.connection.close)

    def enter_patch(self, obj, name, **kwargs):
        mock = patch.object(obj, name, **kwargs)
        self.addCleanup(mock.stop)
        return mock.start()

    def post(self, path, **payload):
        self.connection.request('POST', '/api/ai/'+path, json.dumps(payload), headers={
            'Origin':self.origin, 'Cookie':'sm_owner='+editor.SESSION, 'X-CSRF-Token':editor.CSRF})
        res = self.connection.getresponse()
        return res.status, json.loads(res.read())

    def test_review_then_one_batch_and_retry(self):
        rev = self.data['revision']
        first = dict(id='test-a', group='test', project='da1', kind='installment', category='installment',
                     mode='none', combination='Не суммируется', description=ITEM['terms'],
                     params=dict(minPv=.4, months=4, scheme='deferred', disc=0), name='Пробный график', enabled=True)
        second = dict(first, id='test-b', project='da2')
        def signed(r):
            return dict(record=r, ticket=editor.ticket(rev,r))
        before = signed(first)
        edited = dict(first, description=ITEM['terms'].replace('40%', '45%'))
        answer = {'question':'','edits':[dict(field='minPv', value_json='0.45', quote='взнос 45%')]}
        with patch.object(ai,'generate',return_value=answer):
            status, after = self.post('revise', previous=first, record=edited, ticket=before['ticket'], revision=rev)
        self.assertEqual(status, 200)
        edited['params'] = dict(first['params'], minPv=.45)
        self.assertEqual(after['record'], edited)
        self.assertNotEqual(after['ticket'], before['ticket'])
        for items in ([after,dict(signed(second),record=dict(second, enabled=False))], [after,after], []):
            self.assertEqual(self.post('accept', revision=rev, items=items)[0], 400)
        self.google.assert_not_called()
        self.publish.assert_not_called()
        batch = [after, signed(second)]
        self.publish.side_effect = RuntimeError('Публикация недоступна')
        status, result = self.post('accept', revision=rev, items=batch)
        self.assertEqual(status, 200)
        self.assertTrue(result['saved'])
        self.assertFalse(result['published'])
        self.assertEqual(owner_catalog.read(True)['records'][-2:], [edited,second])
        self.publish.side_effect = None
        self.assertTrue(self.post('accept', revision=rev, items=batch)[1]['published'])
        self.assertEqual(self.post('accept', revision=rev, items=[before])[0], 409)
        self.google.assert_not_called()
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT generation FROM catalog').fetchone()[0], 2)


class DialogTest(unittest.TestCase):
    HARNESS = r'''
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const elements=new Map();
class Element extends EventTarget {
  constructor(tag='div',id=''){super();this.tag=tag;this.id=id;this.children=[];this.value='';this.open=false;this.hidden=false;this.style={};this.dataset={};this.shows=0;this.classList={add(){}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  remove(){this.removed=true;}
  focus(){this.focused=true;}
  showModal(){assert.equal(this.open,false,'duplicate showModal');assert.equal(document.querySelector('dialog[open]'),undefined,'stacked dialogs');this.open=true;this.shows++;}
  close(){if(!this.open)return;this.open=false;setImmediate(()=>this.dispatchEvent(new Event('close')));}
}
const $=id=>{if(!elements.has(id))elements.set(id,new Element(['ai-dialog','tools-editor','owner-window'].includes(id)?'dialog':'div',id));return elements.get(id);};
const document={getElementById:$,createElement:tag=>{const e=new Element(tag);if(tag==='iframe')e.contentWindow={messages:[],postMessage(...args){this.messages.push(args);}};return e;},createTextNode:text=>({textContent:text}),
querySelector:selector=>selector==='dialog[open]'?[...elements.values()].find(e=>e.tag==='dialog'&&e.open):selector==='.tools-shell'?$('shell'):undefined,
querySelectorAll:()=>[...elements.values()].filter(e=>e.tag==='dialog'),documentElement:{dataset:{theme:'light'}},body:new Element(),addEventListener(){}};
const window=new EventTarget();window.parent=window;
const context={window,document,navigator:{},URL,console,Event,MutationObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){}};
const load=path=>vm.runInNewContext(fs.readFileSync(path,'utf8'),context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const emit=(type,source,origin,action)=>{const event=new Event('message');Object.assign(event,{data:{type,action},source,origin});window.dispatchEvent(event);};
'''

    def run_js(self, code):
        result = subprocess.run(['node','-e',self.HARNESS+'\n(async()=>{'+code+'})().catch(e=>{console.error(e);process.exitCode=1;});'],
                                cwd=source.ROOT, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_proposal_editor_lifecycle_and_failed_revision(self):
        self.run_js(r'''
load('assets/tools-proposals.js');
const record={id:'r',project:'da1',kind:'installment',name:'Тест',description:'Условия',mode:'additive',params:{pay:{1:30000},milestones:[{amount:90000,date:'2027-01-01'}]}};
let done,edits=0,fail=false,applied=0,accepted=0,returned=0;
const options={model:{fields:{installment:[{key:'pay.1',label:'Платёж',type:'money'}]},get:(p,k)=>k.split('.').reduce((a,b)=>a?.[b],p),rub:v=>v+' ₽',pct:v=>v+'%',modes:{additive:'Суммируется'}},names:{da1:'ДА'},kinds:{installment:'Рассрочка'},
api:async(path,body)=>{if(path.endsWith('propose'))return {items:[{record,previous:{params:{pay:{1:50000}}},quotes:['Основание'],action:'Изменение',ticket:'t'}],questions:[],revision:'v'};
if(path.endsWith('revise')){if(fail)throw Error('Нет связи');return {record:body.record,ticket:'new-ticket'};}accepted++;assert.equal(body.items[0].ticket,'new-ticket');return {};},
edit:(r,isNew,callback)=>{edits++;done=callback;$('tools-editor').showModal();},pending:()=>[],revision:()=>'v',csrf:()=>'',applied:()=>applied++};
window.SMProposals.setup(options);window.SMProposals.setup(options);
for(const id of ['ai-dialog','tools-editor'])$(id).addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))returned++;});
$('tools-ai').onclick();$('tools-ai').onclick();assert.equal($('ai-dialog').shows,1);
$('ai-text').value='Исходная команда';await $('ai-build').onclick();
const section=$('ai-items').children[0],button=section.children.at(-1);
const text=JSON.stringify(section.children);assert.ok(text.includes('50000 ₽ → 30000 ₽'));assert.ok(text.includes('90000 ₽'));
button.onclick();button.onclick();await tick();assert.equal(edits,1);assert.equal(returned,0);assert.equal($('ai-dialog').open,false);assert.equal(window.SMProposals.isTransitioning(),true);
$('tools-ai').onclick();assert.equal($('ai-dialog').open,false);
fail=true;await assert.rejects(done({...record,name:'Правка'}),/Нет связи/);assert.equal($('tools-editor').open,true);assert.equal($('ai-dialog').open,false);
$('tools-editor').close();await tick();assert.equal($('ai-dialog').open,true);assert.equal(returned,0);assert.equal($('ai-text').value,'Исходная команда');assert.equal($('ai-items').children.length,1);
button.onclick();await tick();fail=false;await done({...record,name:'Правка'});assert.equal($('ai-dialog').open,false);$('tools-editor').close();await tick();assert.equal($('ai-dialog').open,true);assert.equal(window.SMProposals.isTransitioning(),false);
await $('ai-accept').onclick();await tick();assert.equal(accepted,1);assert.equal(applied,1);assert.equal(returned,1);assert.equal($('ai-dialog').open,false);assert.equal($('ai-items').children.length,0);
// A failed open must restore the proposals immediately, without losing the draft.
$('tools-ai').onclick();$('ai-text').value='Новая команда';await $('ai-build').onclick();options.edit=()=>{throw Error('Не удалось открыть');};$('ai-items').children[0].children.at(-1).onclick();await tick();assert.equal($('ai-dialog').open,true);assert.equal(window.SMProposals.isTransitioning(),false);assert.equal($('ai-status').textContent,'Не удалось открыть');
''')

    def test_owner_container_reuses_frame_and_replaces_connection(self):
        self.run_js(r'''
context.location={origin:'https://evgeniigusv.github.io'};load('assets/tools-window.js');
const host=window.SMOwnerWindow,dialog=$('owner-window'),action={kind:'ai',project:'da1',section:'installment'};
host.open(action,'Предложения');const frame=dialog.children.at(-1);assert.equal(frame.hidden,true);assert.equal(frame.style.display,'none');
host.open(action,'Предложения');assert.equal(dialog.shows,1);assert.equal(dialog.children.length,1);
emit('tools:ready',{},'http://127.0.0.1:8795');assert.equal(frame.hidden,true);
emit('tools:ready',frame.contentWindow,'http://127.0.0.1:8795');assert.equal(frame.hidden,false);assert.equal($('owner-connection').hidden,true);assert.equal($('owner-connection').style.display,'none');assert.equal(frame.contentWindow.messages.length,1);
emit('tools:ready',frame.contentWindow,'http://127.0.0.1:8795');assert.equal(frame.contentWindow.messages.length,1);
const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);
emit('tools:close',frame.contentWindow,'http://127.0.0.1:8795');await tick();assert.equal(dialog.open,false);
host.open(action,'Предложения');assert.equal(dialog.children.length,1);assert.equal(frame.contentWindow.messages.length,2);
emit('tools:failed',frame.contentWindow,'http://127.0.0.1:8795');assert.equal(frame.hidden,true);assert.equal($('owner-connection').hidden,false);
$('owner-cancel').onclick();await tick();assert.equal(dialog.open,false);
''')


if __name__ == '__main__':
    unittest.main()
