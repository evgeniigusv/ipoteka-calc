(async function(){
'use strict';
var M=SMToolsModel,U=SMUi,esc=U.esc,$=function(id){return document.getElementById(id);},local=location.hostname==='127.0.0.1'&&location.port==='8795';
var data,baseline,revision,csrf,project='all',category='all',expanded={},collapsed={chpv:true,discount:true,extra:true},changes=new Map(),editing=null,busy=false,pendingPublish=false;
var names={da1:'ДА1',da2:'ДА2',dnk2:'ДНК-2'},kindNames={mortgage:'Ипотечная программа',installment:'Рассрочка',tranche:'Траншевая ипотека',chpv:'Дофинансирование ПВ',discount:'Скидка за полную оплату',info:'Информационный инструмент'};
function icon(n){return '<img src="assets/icons/'+n+'.svg" alt="">';}
function alert(message){$('tools-error').textContent=message||'';$('tools-error').hidden=!message;}
function projects(){return project==='all'?Object.keys(M.projects):[project];}
function header(){return '<tr><th rowspan="2" scope="col">Инструмент</th>'+projects().map(function(p){return '<th colspan="2" scope="colgroup">'+names[p]+'</th>';}).join('')+'</tr><tr>'+projects().map(function(){return '<th scope="col">Условия</th><th scope="col">Сочетание</th>';}).join('')+'</tr>';}
function filtered(forPartners){
 var query=$('tools-search').value.trim().toLowerCase();
 var archived=local&&$('tools-inactive').value==='archive';
 return M.groups({records:data.records.filter(function(r){
   if(r.params.ownerOnly&&(!local||forPartners))return false;
   return r.enabled===!archived&&(!forPartners||r.enabled)
     &&(project==='all'||r.project===project)&&(category==='all'||r.category===category)
     &&(!query||[r.name,r.description,r.combination,M.categories[r.category],...M.summary(r)].join(' ').toLowerCase().includes(query));
 })});
}
function cell(r,pdf){var text=M.summary(r),info=r.kind==='info',html='<div class="tools-cell'+(!r.enabled?' tools-disabled':'')+'">';
 if(!pdf&&r.params.ownerOnly)html+='<p class="tools-tag tools-private">Только владельцу</p>';
 if(r.source==='subsidies')html+='<p class="tools-muted">Автоматически из справочника субсидий '+(r.project==='dnk2'?'ДНК':'ДА')+'</p>';
 if(r.kind==='mortgage')text=[M.pct(r.params.rate)+' · ПВ от '+M.pct(r.params.minPv),r.params.limit?'До '+M.rub(r.params.limit):'До '+r.params.term+' лет'];
 if(r.source==='subsidies'){
  var terms=r.params;
  text=[terms.bank+' · '+M.pct(terms.rate)+' годовых', 'Кредит до '+terms.term+' лет · ПВ от '+M.pct(terms.minPv),terms.limit?'Лимит кредита '+M.rub(terms.limit):'Лимит в источнике не указан'];
  if(local&&!pdf)text.push('Комиссия банку '+M.pct(terms.subsidy));
 }
 if(r.kind==='installment'&&r.params.discFromPv)text=text.map(t=>t.endsWith(' на сумму ПВ')?'Скидка '+t:t);
 if(r.kind==='installment'&&r.params.discAt70)text.push('При ПВ от 70% скидка '+M.pct(r.params.discAt70));
 if(pdf&&r.kind==='installment'){var p=r.params;if(p.pay)text.push('Студия / 1к: '+M.rub(p.pay[1])+' · 2к: '+M.rub(p.pay[2])+' · 3к: '+M.rub(p.pay[3]));if(p.steps)text.push('Платежи каждые '+p.steps.join(' / ')+' мес.');if(p.maxDisc)text.push('Потолок скидки '+M.pct(p.maxDisc));if(p.pvChoices)text.push('Варианты ПВ: '+p.pvChoices.map(M.pct).join(' / '));(p.milestones||[]).forEach(function(m){text.push(M.pct(m.share)+' — '+(m.date?m.date:'через '+m.months+' мес.'));});}
 text.forEach(function(t,i){if(!pdf&&local&&r.source!=='subsidies'&&r.kind==='mortgage'&&i===0)html+='<p><button class="tools-quick" data-quick="'+r.id+'">'+esc(t)+'</button></p>';else if(info&&!pdf&&t.length>320){html+='<p>'+esc(t.slice(0,300))+'…</p><details><summary>Все условия</summary><p>'+esc(t)+'</p></details>';}else html+='<p>'+esc(t)+'</p>';});
 if(r.kind!=='info'&&r.description){if(pdf)html+='<p class="tools-combination">'+esc(r.description)+'</p>';else html+='<details><summary>Примечания</summary><p>'+esc(r.description)+'</p></details>';}
 if(!r.enabled)html+='<span class="tools-tag">В архиве</span>';
 if(local&&!pdf&&r.source!=='subsidies'){
   html+='<div class="tools-record-actions"><button data-edit="'+r.id+'">Редактировать</button><button data-toggle="'+r.id+'">'+(r.enabled?'В архив':'Восстановить')+'</button></div>';
 }
 return html+'</div>';}
function row(g,pdf){return '<tr><th scope="row" class="tools-name">'+esc(g.name)+'</th>'+projects().map(function(p){var rr=g.cells[p]||[];return '<td class="'+(rr.some(function(r){return changes.has(r.id);})&&!pdf?'tools-dirty':'')+'">'+(rr.length?rr.map(function(r){return (r.name!==g.name?'<div class="tools-program-name" title="'+esc(r.name)+'">'+esc(r.kind==='tranche'?(r.params.bank||'Расчёт по ориентиру'):r.name)+'</div>':'')+cell(r,pdf);}).join(''):local&&!pdf&&$('tools-inactive').value==='active'&&g.id&&!Object.values(g.cells).flat().some(function(r){return r.source==='subsidies';})?'<button class="tools-add-cell" data-new-project="'+p+'" data-group="'+g.id+'">Добавить условия</button>':'<span class="tools-muted">—</span>')+'</td><td class="tools-combination" data-label="Сочетание">'+(rr.length?rr.map(function(r){return '<div class="tools-cell"><p title="'+esc(r.combination)+'">'+esc(r.kind==='mortgage'?'По условиям банка':r.combination)+'</p>'+(local&&!pdf&&r.source!=='subsidies'?'<select class="tools-mode-select" data-mode="'+r.id+'" aria-label="Сочетание · '+esc(r.name)+' · '+names[r.project]+'">'+Object.entries(M.modes).map(function(pair){return '<option value="'+pair[0]+'"'+(r.mode===pair[0]?' selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select>':r.combination===M.modes[r.mode]?'':'<span class="tools-tag">'+esc(M.modes[r.mode])+'</span>')+'</div>';}).join(''):'<span class="tools-muted">—</span>')+'</td>';}).join('')+'</tr>';}
function render(){if(!data)return;$('tools-head').innerHTML=header();$('tools-table').dataset.single=String(project!=='all');var gs=filtered(),query=$('tools-search').value.trim(),n=1+projects().length*2,html='';
 var archive=local&&$('tools-inactive').value==='archive';
 var overview=!query&&category==='all'&&!archive;
 Object.entries(M.categories).forEach(function([cat,label]){
   var list=gs.filter(g=>g.category===cat);if(!list.length)return;
   var shut=!!(overview&&collapsed[cat]);
   var title=esc(label)+'<span>'+list.length+'</span>';
   var heading=overview?'<button data-category="'+cat+'" aria-expanded="'+!shut+'">'+icon(shut?'chevron-right':'chevron-down')+title+'</button>':'<div class="tools-section-label">'+title+'</div>';
   html+='<tr class="tools-section"><td colspan="'+n+'">'+heading+'</td></tr>';
   if(shut)return;
   var limit=overview&&!expanded[cat]?(cat==='booking'?1:2):list.length;
   var preview=list.slice(0,limit);
   if(cat==='mortgage'&&limit<list.length){
     var tranche=list.find(g=>Object.values(g.cells).flat().some(r=>r.kind==='tranche'));
     if(tranche&&!preview.includes(tranche))preview[1]=tranche;
   }
   preview.forEach(g=>{html+=row(g,false);});
   if(list.length>limit)html+='<tr class="tools-more"><td colspan="'+n+'"><button data-more="'+cat+'">Показать ещё '+(list.length-limit)+'</button></td></tr>';
   else if(expanded[cat]&&overview)html+='<tr class="tools-more"><td colspan="'+n+'"><button data-less="'+cat+'">Свернуть список</button></td></tr>';
 });
 var empty=archive?'В архиве нет записей по выбранным условиям.':'По выбранным условиям инструментов нет.';
 $('tools-rows').innerHTML=html||'<tr><td colspan="'+n+'" class="tools-empty">'+empty+'</td></tr>';
 $('tools-savebar').hidden=!local;
 $('tools-change-count').textContent=busy?'Подождите…':changes.size?'Записей в черновике: '+changes.size+'. Для записи в Google и обновления сайта нажмите «Сохранить и опубликовать».':pendingPublish?'В Google сохранено. Публикация ожидает повтора.':'Несохранённых изменений нет';
 $('tools-save').disabled=$('tools-reset').disabled=!changes.size||busy;
 $('tools-reload').disabled=$('tools-add').disabled=$('tools-ai').disabled=busy;
 $('tools-rows').inert=busy;
 $('tools-category').disabled=$('tools-inactive').disabled=$('tools-search').disabled=busy;
 $('tools-projects').inert=busy;
 $('tools-publish').hidden=!pendingPublish;
 $('tools-publish').disabled=busy||!!changes.size;
 $('tools-pdf').disabled=busy||!!changes.size||!filtered(true).length;
 $('tools-pdf').title=changes.size?'Сначала сохраните или отмените черновик':'PDF действующих инструментов по выбранным фильтрам';
 $('ai-context').textContent='Выбрано в каталоге: '+(names[project]||'все проекты')+' · '+(M.categories[category]||'все разделы');
 var link=new URL('http://127.0.0.1:8795/tools.html');
 if(project!=='all')link.searchParams.set('project',project);
 if(category!=='all')link.searchParams.set('section',category);
 $('tools-owner-link').href=link.href;
 link.hash='new';
 $('tools-owner-new').href=link.href;
 link.hash='ai';
 $('tools-owner-ai').href=link.href;
}
function status(){var date=data.full_checked_at||data.checked_at;$('tools-status').textContent=(local?'Личный редактор · ':'')+'Проверено '+new Date(date).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' · Екатеринбург';if(Date.now()-Date.parse(date)>8*86400000)alert('Справочник не проверялся больше недели. Подтвердите условия перед отправкой партнёрам.');}
function field(label,name,value,type,wide,options){var s='<label class="tools-field'+(wide?' wide':'')+'">'+esc(label);if(options)s+='<select name="'+name+'">'+options.map(function(o){var v=typeof o==='string'?o:o[0],l=typeof o==='string'?o:o[1];return '<option value="'+esc(v)+'"'+(String(value)===v?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select>';else if(type==='textarea')s+='<textarea name="'+name+'">'+esc(value||'')+'</textarea>';else s+='<input name="'+name+'" type="'+(type||'text')+'"'+(type==='checkbox'?(value?' checked':''):' value="'+esc(value==null?'':value)+'"')+'>';return s+'</label>';}
var kindsByCategory={mortgage:['mortgage','tranche','info'],installment:['installment','info'],chpv:['chpv','info'],discount:['info','discount'],extra:['info'],booking:['info']};
function editorFields(r,isNew){
 var kinds=kindsByCategory[r.category]||[];
 var html=field('Проект','project',r.project,'select',false,[['','Выберите проект'],...Object.entries(names)])
   +field('Раздел','category',r.category,'select',false,[['','Выберите раздел'],...Object.entries(M.categories)])
   +field('Название','name',r.name,'text',true)
   +field('Механика расчёта','kind',r.kind,'select',true,kinds.length?kinds.map(k=>[k,kindNames[k]]):[['','Сначала выберите раздел']]);
 html+=field('Условия инструмента','description',r.description,'textarea',true)+field('Сочетание с акциями','combination',r.combination,'textarea',true)+field('Правило сочетания','mode',r.mode,'select',true,Object.entries(M.modes));
 (M.fields[r.kind]||[]).forEach(function(f){var v=M.get(r.params,f.key),type=f.type;if(type==='percent'&&v!=null)v=+(v*100).toFixed(6);if(type==='steps')v=(v||[]).join(', ');if(type==='percentList')v=(v||[]).map(function(n){return +(n*100).toFixed(4);}).join('; ');var opts=type==='select'?f.options.map(function(o,i){return [o,f.labels?f.labels[i]:o||'Не применяется'];}):null;if(r.kind==='tranche'&&f.key==='tranches')opts=[['','По согласованию'],...opts];html+=field(f.label,'p:'+f.key,v,type==='boolean'?'checkbox':type==='date'?'date':'text',false,opts);});
 if(r.params.validUntil)html+=field('Дата окончания действия в источнике','validUntil',r.params.validUntil,'date',true);
 if(r.kind==='installment'){html+='<div class="tools-field wide">Промежуточные этапы (% от стоимости)<div id="tools-milestones" class="tools-milestones"></div><button type="button" id="tools-add-stage" class="t-btn">Добавить этап</button><small>Для этапа укажите дату или количество месяцев после сделки. Остаток рассчитывается автоматически.</small></div>';}
 $('tools-editor-fields').innerHTML=html;var form=$('tools-form');form.elements.kind.disabled=!isNew||kinds.length<2;
 form.elements.project.disabled=!isNew;form.elements.category.disabled=!isNew&&r.kind!=='info';
 if(!isNew&&!form.elements.category.disabled)form.elements.category.options[0].disabled=true;
 form.elements.name.required=form.elements.project.required=form.elements.category.required=true;
 if(r.kind==='installment')(r.params.milestones||[]).forEach(addStage);
 function switchFields(event){
   ['name','project','description','combination','mode'].forEach(function(k){r[k]=form.elements[k].value;});
   var nextCategory=form.elements.category.value,options=kindsByCategory[nextCategory]||[];
   var kind=event.target.name==='category'?(isNew?options[0]:'info'):form.elements.kind.value;
   r.category=nextCategory;
   if(kind!==r.kind){var ownerOnly=r.params.ownerOnly;r.kind=kind;r.params=defaults(kind);if(ownerOnly)r.params.ownerOnly=true;}
   editorFields(r,isNew);
   form.elements[event.target.name].focus();
 }
 form.elements.category.onchange=form.elements.kind.onchange=switchFields;
 if($('tools-add-stage'))$('tools-add-stage').onclick=function(){addStage({});};
}
function defaults(kind){return kind==='mortgage'?{type:'Базовая ипотека',term:30,minPv:.201,subsidy:0}:kind==='installment'?{scheme:'deferred',minPv:.2,months:12,disc:0}:kind==='tranche'?{tranches:2,minPv:.201,firstRub:100000,secondMonths:12}:kind==='chpv'?{minDown:.201,cost:.25,overRate:.14,years:15}:kind==='discount'?{scope:'cash',percent:0}:{};}
function addStage(m){var div=document.createElement('div');div.className='tools-milestone';div.innerHTML='<input data-stage="share" inputmode="decimal" aria-label="Доля этапа, %" placeholder="Доля, %" value="'+esc(m.share?+(m.share*100).toFixed(4):'')+'"><input data-stage="date" type="date" aria-label="Дата этапа" value="'+esc(m.date?(m.date.length===7?m.date+'-01':m.date):'')+'"><input data-stage="months" type="number" min="1" max="60" aria-label="Месяцев после сделки" placeholder="Или месяцев" value="'+esc(m.months||'')+'"><button type="button" class="t-icon" aria-label="Убрать этап">'+icon('x-lg')+'</button>';div.querySelector('button').onclick=function(){div.remove();};$('tools-milestones').appendChild(div);}
var proposalEdit=null;
function openEditor(id,group,targetProject,draft,newProposal){
 if(draft||id){
   editing=M.clone(draft||data.records.find(r=>r.id===id));
 }else if(group){
   var template=data.records.find(r=>r.group===group&&r.enabled);
   editing=Object.assign(M.clone(template),{id:'tool-'+crypto.randomUUID(),project:targetProject});
 }else{
   var kind=(kindsByCategory[category]||[])[0];
   editing={id:'tool-'+crypto.randomUUID(),group:'group-'+crypto.randomUUID(),name:'',
     project:project==='all'?'':project,category:category==='all'?'':category,kind:kind,params:defaults(kind),
     description:'',combination:'',mode:'none',enabled:true};
 }
 $('tools-editor-title').textContent=id?editing.name:'Новый инструмент';
 $('tools-editor-project').textContent=[names[editing.project]||'Черновик инструмента',editing.params.ownerOnly?'Только владельцу':''].filter(Boolean).join(' · ');
 $('tools-form-error').textContent='';
 $('tools-form').querySelector('button[type=submit]').textContent=draft?'Обновить предложение':'В черновик';
 editorFields(editing,!id||newProposal);
 $('tools-editor').showModal();
}
function numeric(value,label){var s=value.trim().replace(/\s/g,'').replace(',','.');if(!/^(?:\d+)(?:\.\d+)?$/.test(s))throw Error(label+': введите число.');return Number(s);}
$('tools-form').onsubmit=async function(e){e.preventDefault();if(busy)return;busy=true;var submit=e.currentTarget.querySelector('button[type=submit]');submit.disabled=true;$('tools-close').disabled=$('tools-cancel').disabled=true;try{var form=e.currentTarget,r=M.clone(editing),p=M.clone(r.params);['name','project','kind','category','description','combination','mode'].forEach(function(k){r[k]=form.elements[k].value;});
 M.fields[r.kind].forEach(function(f){var input=form.elements['p:'+f.key],v=input.value.trim();if(f.type==='boolean'){if(!input.checked&&M.get(p,f.key)==null)return;v=input.checked;}else if(v===''){if(f.key.includes('.')){var keys=f.key.split('.');if(p[keys[0]])delete p[keys[0]][keys[1]];}else delete p[f.key];return;}else if(['integer','money','percent'].includes(f.type)){v=numeric(v,f.label);if(f.type==='percent')v/=100;}else if(['steps','percentList'].includes(f.type)){v=v.split(f.type==='steps'?/[,;]+/:/;/).map(function(s){return numeric(s,f.label)/(f.type==='percentList'?100:1);});}M.set(p,f.key,v);});
 if(p.pay&&!Object.keys(p.pay).length)delete p.pay;
 if(r.kind==='installment'){var stages=Array.from($('tools-milestones').children).map(function(div){var o={share:numeric(div.querySelector('[data-stage=share]').value,'Доля этапа')/100},date=div.querySelector('[data-stage=date]').value,months=div.querySelector('[data-stage=months]').value;if(date)o.date=date;if(months)o.months=numeric(months,'Месяцев');return o;});if(stages.length)p.milestones=stages;else delete p.milestones;delete p.noExtra;delete p.extraSequential;}
 if(form.elements.validUntil){if(form.elements.validUntil.value)p.validUntil=form.elements.validUntil.value;else delete p.validUntil;}
 r.params=p;
 var original=baseline.records.find(function(item){return item.id===r.id;});
 if(!proposalEdit&&(!original||['name','description','combination'].some(function(k){return r[k]!==original[k];}))){
   $('tools-form-error').textContent='Проверяю условия и параметры расчёта…';
   var preview=await api('/api/events/tools-changed',{revision:revision,changes:[r],preview:true});r=preview.changes[0];
 }
 if(proposalEdit){$('tools-form-error').textContent='Проверяю исправления…';await proposalEdit(r);proposalEdit=null;$('tools-editor').close();return;}stageRecord(r);
 if(!original){$('tools-inactive').value='active';$('tools-search').value='';selectProject(r.project);category=$('tools-category').value=r.category;}
 $('tools-editor').close();render();}catch(err){$('tools-form-error').textContent=err.message;}finally{busy=false;submit.disabled=false;$('tools-close').disabled=$('tools-cancel').disabled=false;render();}};
$('tools-editor').addEventListener('cancel',function(e){if(busy)e.preventDefault();});
$('tools-close').onclick=$('tools-cancel').onclick=function(){$('tools-editor').close();};
$('tools-add').onclick=function(){openEditor();};$('tools-search').oninput=render;$('tools-inactive').onchange=render;
function selectProject(value){
 project=value;
 $('tools-projects').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.project===value)));
}
$('tools-projects').onclick=function(e){var b=e.target.closest('[data-project]');if(b){selectProject(b.dataset.project);render();}};
$('tools-category').onchange=function(e){category=e.target.value;render();};
function stageRecord(r){
 M.validateRecord(r);
 var candidate=M.clone(data),index=candidate.records.findIndex(x=>x.id===r.id);
 if(index<0)candidate.records.push(r);else candidate.records[index]=r;
 M.validate(candidate);data=candidate;
 var original=baseline.records.find(x=>x.id===r.id);
 if(JSON.stringify(r)===JSON.stringify(original))changes.delete(r.id);else changes.set(r.id,r);
 render();
}
function quickEdit(button){var r=data.records.find(function(x){return x.id===button.dataset.quick;}),form=document.createElement('form');form.className='tools-quick-form';form.innerHTML='<input aria-label="Ставка, % · '+esc(names[r.project])+'" inputmode="decimal" value="'+esc(+(r.params.rate*100).toFixed(6))+'"><button class="t-icon" aria-label="Применить ставку">'+icon('check-lg')+'</button><button type="button" class="t-icon" aria-label="Отменить ставку">'+icon('x-lg')+'</button>';button.replaceWith(form);form.querySelector('input').focus();form.querySelector('button[type=button]').onclick=render;form.onsubmit=function(e){e.preventDefault();try{var next=M.clone(r);next.params.rate=numeric(form.querySelector('input').value,'Ставка')/100;stageRecord(next);alert('');}catch(err){alert(err.message);}};}
$('tools-rows').onchange=function(e){if(!local||!e.target.dataset.mode)return;try{var r=M.clone(data.records.find(function(x){return x.id===e.target.dataset.mode;}));r.mode=e.target.value;stageRecord(r);alert('');}catch(err){alert(err.message);render();}};
$('tools-rows').onclick=function(e){var b=e.target.closest('button');if(!b||busy)return;if(b.dataset.toggle&&local){
 var record=data.records.find(r=>r.id===b.dataset.toggle);
 if(record&&record.source!=='subsidies'){try{stageRecord({...record,enabled:!record.enabled});alert('');}catch(err){alert(err.message);}}
 return;
}if(b.dataset.newProject&&local){openEditor(null,b.dataset.group,b.dataset.newProject);return;}if(b.dataset.quick&&local){quickEdit(b);return;}if(b.dataset.edit&&local)openEditor(b.dataset.edit);if(b.dataset.category){collapsed[b.dataset.category]=!collapsed[b.dataset.category];render();}if(b.dataset.more){expanded[b.dataset.more]=true;render();}if(b.dataset.less){expanded[b.dataset.less]=false;render();}};
$('tools-reset').onclick=function(){if(confirm('Отменить несохранённые изменения?')){data=M.clone(baseline);changes.clear();alert('');render();}};
async function api(path,body){var res=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'}),j=await res.json();if(!res.ok)throw Error(j.error||'Не удалось выполнить запрос.');return j;}
function accepted(d){M.validate(d);data=M.clone(d);baseline=M.clone(d);revision=d.revision;changes.clear();status();render();}
$('tools-reload').onclick=async function(){if(changes.size&&!confirm('Перечитать Google и отменить несохранённые изменения?'))return;try{busy=true;render();accepted(await api('/api/tools'));alert('');}catch(e){alert(e.message);}finally{busy=false;render();}};
async function save(publishOnly){if(busy)return;busy=true;render();alert('');try{var res=await api(publishOnly?'/api/publish':'/api/events/tools-changed',publishOnly?{}:{revision:revision,changes:Array.from(changes.values())});accepted(res.data);pendingPublish=!res.published;alert(res.published?'Сохранено в Google. Публичный сайт обновится после сборки GitHub Pages, обычно за 1–2 минуты.':'В Google сохранено. Публикация не завершена. '+res.error);}catch(e){alert(e.message);}finally{busy=false;render();}}
$('tools-save').onclick=function(){save(false);};$('tools-publish').onclick=function(){save(true);};
window.addEventListener('beforeunload',function(e){if(changes.size){e.preventDefault();e.returnValue='';}});
function pdfChunks(g){var records=Object.values(g.cells).flat(),max=Math.max(1,...records.map(function(r){return Math.ceil(r.description.length/550);})),out=[];for(var i=0;i<max;i++){var copy={name:g.name+(i?' · продолжение':''),category:g.category,cells:{}};Object.keys(g.cells).forEach(function(p){copy.cells[p]=g.cells[p].filter(function(r){return i===0||r.description.length>i*550;}).map(function(r){var c=M.clone(r);c.description=r.description.slice(i*550,(i+1)*550);if(i){c.kind='info';c.combination='';}return c;});});out.push(copy);}return out;}
function pdfPages(png){var pages=[],page,tbody,host=document.createElement('div');host.style.cssText='position:absolute;left:-20000px;top:0;width:1123px';document.body.appendChild(host);var section='',count=0;
 function next(){page=U.page(U.reportHead('Инструменты',projects().map(function(p){return names[p];}).join(' · ')+' · '+new Date(data.full_checked_at||data.checked_at).toLocaleDateString('ru-RU'),png)+'<table class="tools-table"><thead>'+header()+'</thead><tbody></tbody></table><p class="tools-legal">Предварительные условия. Применимость и сочетание акций подтверждаются перед сделкой.</p>','landscape');page.classList.add('tools-pdf');page.style.width='1123px';page.style.minHeight='0';host.appendChild(page);pages.push(page);tbody=page.querySelector('tbody');count=0;}
 function addCategory(cat){tbody.insertAdjacentHTML('beforeend','<tr class="tools-section"><td colspan="'+(1+projects().length*2)+'">'+esc(M.categories[cat])+'</td></tr>');}
 var groups=filtered(true);next();try{Object.keys(M.categories).forEach(function(cat){var list=groups.filter(function(g){return g.category===cat;});if(!list.length)return;list.flatMap(pdfChunks).forEach(function(g){if(section!==cat){section=cat;addCategory(cat);}var node=document.createElement('tbody');node.innerHTML=row(g,true);var tr=node.firstChild;tbody.appendChild(tr);if(page.scrollHeight>750&&count){tr.remove();if(tbody.lastChild&&tbody.lastChild.classList.contains('tools-section'))tbody.lastChild.remove();next();addCategory(cat);tbody.appendChild(tr);}count++;});});pages.forEach(function(p,i){p.querySelector('.tools-legal').textContent+=' · '+(i+1)+' / '+pages.length;p.style.minHeight='794px';p.remove();});return {pages:pages,file:'Инструменты '+projects().map(function(p){return names[p];}).join(' ')+' '+new Date().toLocaleDateString('ru-RU')};}finally{host.remove();}}
$('tools-pdf').onclick=async function(){var b=$('tools-pdf');busy=true;render();alert('');var old=b.innerHTML;b.textContent='Готовлю PDF…';try{var r=await U.makePdf(pdfPages,'landscape');r.pdf.save(r.file);}catch(e){alert('Не удалось подготовить PDF. Проверьте соединение и повторите.');}finally{busy=false;b.innerHTML=old;render();}};
window.addEventListener('beforeprint',function(){
 var host=$('tools-print');
 host.replaceChildren();
 if(!data||changes.size){host.textContent='Для печати сохраните или отмените изменения.';return;}
 var groups=filtered(true);
 if(!groups.length){host.textContent='Нет инструментов для печати.';return;}
 var title=document.createElement('h1');title.textContent='Инструменты · '+projects().map(p=>names[p]).join(' · ');host.appendChild(title);
 var table=document.createElement('table');table.className='tools-table';table.createTHead().innerHTML=header();
 var body=table.createTBody();
 Object.entries(M.categories).forEach(function([key,label]){
   var items=groups.filter(g=>g.category===key);if(!items.length)return;
   var head=body.insertRow().insertCell();head.colSpan=1+projects().length*2;head.textContent=label;
   items.forEach(g=>body.insertAdjacentHTML('beforeend',row(g,true)));
 });
 host.appendChild(table);
});
window.addEventListener('afterprint',function(){$('tools-print').replaceChildren();});
Object.entries(M.categories).forEach(function([key,label]){$('tools-category').add(new Option(label,key));});
var params=new URLSearchParams(location.search);
if(Object.hasOwn(names,params.get('project')))selectProject(params.get('project'));
if(Object.hasOwn(M.categories,params.get('section')))category=$('tools-category').value=params.get('section');
await window.SM_TOOLS_READY;
if(!window.SM_TOOLS_DATA){alert('Справочник не загрузился. Обновите страницу.');$('tools-status').textContent='Источник недоступен';$('tools-pdf').disabled=true;$('tools-rows').innerHTML='';return;}
if(local){
 window.SMProposals.setup({api:function(path,body){
   if(path==='/api/ai/propose'){
     var context=[project==='all'?'':'Проект: '+names[project],category==='all'?'':'Раздел: '+M.categories[category]].filter(Boolean);
     if(context.length)body={...body,text:'Выбрано в каталоге: '+context.join(' · ')+'.\n'+body.text};
   }
   return api(path,body);
 },csrf:function(){return csrf;},model:M,names:names,kinds:kindNames,
 revision:function(){return revision;},edit:function(record,isNew,done){proposalEdit=done;openEditor(record.id,null,null,record,isNew);},
 applied:function(res){
   var pending=Array.from(changes.values());accepted(res.data);
   pending.forEach(function(r){var i=data.records.findIndex(function(x){return x.id===r.id;});if(i<0)data.records.push(r);else data.records[i]=r;changes.set(r.id,r);});
   pendingPublish=!res.published;render();alert(res.published?'Выбранные предложения сохранены. Сайт обновится после сборки.':'В Google сохранено. Публикация не завершена. '+res.error);
 },pending:function(){return Array.from(changes.keys());}});
 $('tools-editor').addEventListener('close',function(){proposalEdit=null;});
 var session=window.SM_TOOLS_SESSION;csrf=session.csrf;$('tools-source').href=session.source;$('tools-source').hidden=false;$('tools-add').hidden=false;$('tools-owner').hidden=true;$('tools-inactive-label').hidden=false;}
accepted(window.SM_TOOLS_DATA);
if(local && (location.hash==='#new'||location.hash==='#ai')){
 var action=location.hash==='#new'?'tools-add':'tools-ai';
 history.replaceState(null,'',location.pathname+location.search);
 $(action).click();
}
window.SMToolsMortgageNotices(function(){return data;});
if(data.writeNotice)alert(data.writeNotice);
})();
