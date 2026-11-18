(async function(){
'use strict';
var M=SMToolsModel,U=SMUi,esc=U.esc,$=function(id){return document.getElementById(id);},local=location.hostname==='127.0.0.1'&&location.port==='8795'&&!window.SM_TOOLS_PARTNER_VIEW;
var data,baseline,revision,csrf,project='all',category='all',collapsed={},changes=new Map(),editing=null,busy=false,pendingPublish=false;
var settingsEditor=null,view='catalog',needsRefresh=false;
var names={da1:'ДА1',da2:'ДА2',dnk2:'ДНК-2'},kindNames={mortgage:'Ипотечная программа',installment:'Рассрочка',tranche:'Траншевая ипотека',chpv:'Дофинансирование ПВ',discount:'Скидка за полную оплату',info:'Информационный инструмент'};
function icon(n){return '<img src="assets/icons/'+n+'.svg" alt="">';}
function alert(message){$('tools-error').textContent=message||'';$('tools-error').hidden=!message;}
function projects(){return project==='all'?Object.keys(M.projects):[project];}
function header(){return '<tr><th rowspan="2" scope="col">Инструмент</th>'+projects().map(function(p){return '<th colspan="2" scope="colgroup">'+names[p]+'</th>';}).join('')+'</tr><tr>'+projects().map(function(){return '<th scope="col">Условия</th><th scope="col">Сочетание</th>';}).join('')+'</tr>';}
const generalMortgageLabel='Общие условия ипотеки';
let generalMortgageOpen=false;
const expandedMortgages=new Set();
function searchText(text){return text.toLowerCase().replace(/ё/g,'е').replace(/ит(?=[ -]*ипотек)/g,'it');}
function filtered(forPartners){
 var query=searchText($('tools-search').value.trim());
 var archived=local&&$('tools-inactive').value==='archive';
 return M.groups({records:data.records.filter(function(r){
   if(r.params.ownerOnly&&(!local||forPartners))return false;
   const section=M.section(r);
   const typeLabel=section==='mortgage'?(M.mortgageTypes[M.mortgageBucket(r)]||generalMortgageLabel):'';
   return r.enabled===!archived&&(!forPartners||r.enabled)
     &&(project==='all'||r.project===project)&&(category==='all'||section===category)
     &&(!query||searchText([r.name,r.description,r.combination,M.categories[section],typeLabel,r.params.bank,...M.summary(r)].join(' ')).includes(query));
 })});
}
function reportCell(r){
 const p=r.params;
 const lines=M.summary(r);
 if(r.kind==='installment'){
  if(p.scheme==='monthly'&&p.pay)lines.push('Студия / 1к: '+M.rub(p.pay[1])+' · 2к: '+M.rub(p.pay[2])+' · 3к: '+M.rub(p.pay[3]));
  if(p.scheme==='equal'&&p.steps)lines.push('Платежи каждые '+p.steps.join(' / ')+' мес.');
  lines.push('При ПВ от 71% — актуальная скидка за полную оплату');
  if(['monthly','scheduled'].includes(p.scheme))(p.milestones||[]).forEach(m=>lines.push((m.amount!=null?M.rub(m.amount):M.pct(m.share))+' — '+(m.date||'через '+m.months+' мес.')));
 }
 if(r.kind!=='info'&&r.description)lines.push(r.description);
 return lines;
}
function reportRow(g){
 const cells=projects().map(key=>{
  const records=g.cells[key]||[];
  const terms=records.map(r=>'<div class="tools-cell">'+(r.name!==g.name?'<strong>'+esc(r.name)+'</strong>':'')+
   reportCell(r).map(line=>'<p>'+esc(line)+'</p>').join('')+'</div>').join('');
  const combination=records.map(r=>'<div class="tools-cell"><p>'+esc(M.combination(r,data.records))+'</p>'+
   (M.combination(r,data.records)!==M.modes[r.mode]?'<span class="tools-tag">'+esc(M.modes[r.mode])+'</span>':'')+'</div>').join('');
  return '<td>'+(terms||'—')+'</td><td>'+(combination||'—')+'</td>';
 });
 return '<tr><th scope="row" class="tools-name">'+esc(g.name)+'</th>'+cells.join('')+'</tr>';
}

function compactHeader(){
 return '<tr><th scope="col">Инструмент</th>'+projects().map(p=>'<th scope="col">'+names[p]+'</th>').join('')+'</tr>';
}

function brief(r){
 const p=r.params;
 switch(r.kind){
  case 'mortgage': return M.pct(p.rate)+' годовых';
  case 'tranche': return p.estimate?'Платёж от '+M.rub(p.referencePayment)+'/мес.':p.rate?M.pct(p.rate)+' годовых':'ПВ от '+M.pct(p.minPv);
  case 'chpv': return M.pct(p.rate)+' · до '+M.rub(p.limit);
  case 'discount': return 'До '+M.pct(p.percent);
  case 'installment': {
   const terms=['ПВ от '+M.pct(p.minPv)];
   if(p.discFromPv)terms.push('скидка '+M.pct(p.discFromPv)+' на ПВ');
   else if(p.disc)terms.push('скидка '+M.pct(p.disc));
   else if(p.pay)terms.push('от '+M.rub(Math.min(...Object.values(p.pay)))+'/мес.');
   return terms.join(' · ');
  }
  default: {
   if(r.category==='discount'&&typeof p.percent==='number')return 'Скидка '+M.pct(p.percent);
   const line=r.description.trim().split(/\r?\n/)[0];
   return line.length>78 ? line.slice(0,77).replace(/\s+\S*$/,'')+'…' : line||'Условия не указаны';
  }
 }
}

function editAction(r){
 if(!local)return '';
 const label='Редактировать';
 const aria=esc(label+' · '+r.name+' · '+names[r.project]);
 return '<button type="button" class="tool-record-edit" aria-label="'+aria+'" data-edit="'+r.id+'">'+icon('pencil')+label+'</button>';
}

function compactCell(r){
 const lines=reportCell(r);
 const p=r.params;
 if(r.mode&&M.combination(r,data.records)!==M.modes[r.mode])lines.push('Правило сочетания: '+M.modes[r.mode]);
 if(r.params.appManaged)lines.push('Условия ведутся в приложении');
 if(r.source==='subsidies')lines.push('Из справочника субсидий '+(r.project==='dnk2'?'ДНК':'ДА'));
 if(local&&r.kind==='mortgage')lines.push('Комиссия банку '+M.pct(p.subsidy));
 lines.push('Сочетание: '+M.combination(r,data.records));
 const copy=local?'<button type="button" class="tools-add-cell" data-copy="'+r.id+'">Создать копию</button>':'';
 const archive=local?'<button type="button" class="tools-add-cell" data-toggle="'+r.id+'">'+(r.enabled?'В архив':'Восстановить')+'</button>':'';
 return '<article class="tool-entry" data-record="'+r.id+'">'+(p.ownerOnly?'<span class="tools-tag tools-private">Только владельцу</span>':'')+
   '<p class="tool-brief">'+esc(brief(r))+'</p><div class="tool-entry-actions"><details><summary>Подробнее</summary><div class="tool-full">'+
   [...new Set(lines)].filter(Boolean).map(line=>'<p>'+esc(line)+'</p>').join('')+'<div class="tool-secondary">'+copy+archive+'</div></div></details>'+editAction(r)+'</div></article>';
}

function compactRow(group){
 const template=Object.values(group.cells).flat()[0];
 const cells=projects().map(projectKey=>{
  const records=group.cells[projectKey]||[];
  let contents=records.map(r=>(r.name!==group.name?'<strong>'+esc(r.name)+'</strong>':'')+compactCell(r)).join('');
  if(local && !records.length && $('tools-inactive').value==='active' && !activeInProject(template,projectKey)){
   const label='Добавить условия · '+group.name+' · '+names[projectKey];
   contents='<button type="button" class="tools-add-cell" aria-label="'+esc(label)+'" data-new-project="'+projectKey+'" data-template="'+esc(template.id)+'">+ Добавить</button>';
  }
  return '<td data-project-label="'+names[projectKey]+'" class="'+(records.some(r=>changes.has(r.id))?'tools-dirty':'')+'">'+(contents||'—')+'</td>';
 });
 return '<tr><th class="tools-name" scope="row">'+esc(group.name)+'</th>'+cells.join('')+'</tr>';
}

function editRecord(id){
 const record=data.records.find(r=>r.id===id);
 if(!record){alert('Инструмент больше не найден. Выберите его в каталоге.');return;}
 if(!record.enabled)$('tools-inactive').value='archive';
 openEditor(id);
}

function takeOwnership(record){
 const draft=M.clone(record);
 delete draft.source;
 draft.params.appManaged=true;
 return draft;
}

function mortgageOverview(groups, query, archive){
 const buckets=new Map();
 for(const group of groups){
  for(const rows of Object.values(group.cells)){
   for(const record of rows){
    const key=M.mortgageBucket(record);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(record);
   }
  }
 }
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg'}).format(new Date());
 let html='';
 for(const [key,label] of Object.entries(M.mortgageTypes)){
  const rows=buckets.get(key)||[];
  if(!rows.length&&(query||archive))continue;
  const expanded=rows.length>0&&(query!==''||expandedMortgages.has(key));
  let title=esc(label);
  if(rows.length&&!query){
   const action=expanded?'Свернуть':'Подробнее';
   title='<button type="button" class="tools-type-toggle" data-mortgage-type="'+key+
     '" aria-label="'+esc(action+' · '+label)+'" aria-expanded="'+expanded+'">'+
     icon(expanded?'chevron-down':'chevron-right')+'<span>'+esc(label)+'</span><span class="tools-type-action">'+action+'</span></button>';
  }
  const cells=projects().map(projectKey=>{
   const records=rows.filter(r=>r.project===projectKey);
   const offers=records.filter(r=>r.enabled&&(!r.params.validUntil||r.params.validUntil>=today)).flatMap(M.mortgageOffers);
   let text='—';
   if(offers.length){
    const best=Math.min(...offers.map(o=>o.rate));
    const banks=[...new Set(offers.filter(o=>o.rate===best).map(o=>o.bank))];
    text='от '+M.pct(best)+' · '+banks.join(', ');
   }else if(records.length){
    text=archive?'В архиве':'См. условия';
   }
   return '<td data-project-label="'+names[projectKey]+'">'+esc(text)+'</td>';
  });
  html+='<tr class="tools-mortgage-type" id="mortgage-type-'+key+'"><th class="tools-name" scope="row">'+title+'</th>'+cells.join('')+'</tr>';
  if(expanded)html+=M.groups({records:rows}).map(compactRow).join('');
 }
 const general=buckets.get('other');
 if(general?.length){
  const title=query?generalMortgageLabel:'<button type="button" class="tools-type-toggle" data-mortgage-general aria-expanded="'+generalMortgageOpen+'">'+
   icon(generalMortgageOpen?'chevron-down':'chevron-right')+generalMortgageLabel+'</button>';
  html+='<tr class="tools-mortgage-general"><td colspan="'+(1+projects().length)+'">'+title+'</td></tr>';
  if(query||generalMortgageOpen)html+=M.groups({records:general}).map(compactRow).join('');
 }
 return html;
}

function render(){if(!data)return;$('tools-head').innerHTML=compactHeader();$('tools-table').dataset.single=String(project!=='all');var gs=filtered(),query=$('tools-search').value.trim(),n=1+projects().length,html='';
 var archive=local&&$('tools-inactive').value==='archive';
 var overview=!query&&category==='all'&&!archive;
 Object.entries(M.categories).forEach(function([cat,label]){
   var list=gs.filter(g=>g.category===cat);if(!list.length)return;
   var shut=!!(overview&&collapsed[cat]);
   var title=esc(label)+'<span>'+list.length+'</span>';
   var heading=overview?'<button data-category="'+cat+'" aria-expanded="'+!shut+'">'+icon(shut?'chevron-right':'chevron-down')+title+'</button>':'<div class="tools-section-label">'+title+'</div>';
   html+='<tr class="tools-section"><td colspan="'+n+'">'+heading+'</td></tr>';
   if(shut)return;
   html+=cat==='mortgage'?mortgageOverview(list,query,archive):list.map(compactRow).join('');
 });
 var empty=archive?'В архиве нет записей по выбранным условиям.':'По выбранным условиям инструментов нет.';
 $('tools-rows').innerHTML=html||'<tr><td colspan="'+n+'" class="tools-empty">'+empty+'</td></tr>';
 $('tools-savebar').hidden=!local||view!=='catalog';
 $('tools-change-count').textContent=busy?'Подождите…':changes.size?'Записей в черновике: '+changes.size+'. Нажмите «Сохранить и опубликовать».':pendingPublish?'Изменения сохранены. Публикация ожидает повтора.':'Несохранённых изменений нет';
 $('tools-save').disabled=$('tools-reset').disabled=!changes.size||busy;
 $('tools-reload').disabled=$('tools-add').disabled=$('tools-ai').disabled=busy;
 $('tools-rows').inert=busy;
 $('tools-category').disabled=$('tools-inactive').disabled=$('tools-search').disabled=busy;
 $('tools-projects').inert=busy;
 $('tools-publish').hidden=!pendingPublish;
 $('tools-publish').disabled=busy||!!changes.size;
 $('tools-pdf').disabled=busy||!!changes.size||!filtered(true).length;
 $('tools-pdf').title=changes.size?'Сначала сохраните или отмените черновик':'PDF действующих инструментов по выбранным фильтрам';
 if(settingsEditor)settingsEditor.refresh();
 $('ai-context').textContent='Выбрано в каталоге: '+(names[project]||'все проекты')+' · '+(M.categories[category]||'все разделы');

}
function status(){var date=data.full_checked_at||data.checked_at;$('tools-status').textContent=(local?'Личный редактор · ':'')+'Проверено '+new Date(date).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' · Екатеринбург';if(Date.now()-Date.parse(date)>8*86400000)alert('Справочник не проверялся больше недели. Подтвердите условия перед отправкой партнёрам.');}
function field(label,name,value,type,wide,options){var s='<label class="tools-field'+(wide?' wide':'')+'"><span class="tools-field-title">'+esc(label)+'</span>';if(options)s+='<select name="'+name+'">'+options.map(function(o){var v=typeof o==='string'?o:o[0],l=typeof o==='string'?o:o[1];return '<option value="'+esc(v)+'"'+(String(value)===v?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select>';else if(type==='textarea')s+='<textarea name="'+name+'">'+esc(value||'')+'</textarea>';else s+='<input name="'+name+'" type="'+(type||'text')+'"'+(type==='checkbox'?(value?' checked':''):' value="'+esc(value==null?'':value)+'"')+'>';return s+'</label>';}
var kindsByCategory={mortgage:['mortgage','info'],installment:['installment','info'],tranche:['tranche','info'],chpv:['chpv','info'],discount:['info','discount'],extra:['info'],booking:['info']};
let editorDrafts = new Map();
function editorFields(r,isNew){
 const section=M.section(r),kinds=kindsByCategory[section]||[];
 let html=field('Проект','project',r.project,'select',false,[['','Выберите проект'],...Object.entries(names)])
   +field('Раздел','category',section,'select',false,[['','Выберите раздел'],...Object.entries(M.categories)])
   +field('Тип записи','kind',r.kind,'select',true,kinds.length?kinds.map(k=>[k,k==='info'?(section==='discount'?'Акция':'Условия текстом'):kindNames[k]]):[['','Сначала выберите раздел']])
   +field('Название','name',r.name,'text',true)
   +field('Пояснение для партнёров','description',r.description,'textarea',true)
   +field('Сочетание с акциями','combination',r.combination,'textarea',true)
   +field('Как применять дополнительные скидки','mode',r.mode,'select',true,Object.entries(M.modes));
 if(isNew&&!proposalEdit)html+=field('Кому виден инструмент','visibility',r.params.ownerOnly?'private':'public','select',true,[['public','Партнёрам'],['private','Только мне']]);
 if(r.source==='subsidies')html+='<p class="tools-ownership-note">Ставка и комиссия обновляются из справочника субсидий. Здесь можно настроить акции и доступность. Если изменить банковские условия вручную, эта программа перейдёт под управление приложения.</p>';
 for(const f of M.fields[r.kind]||[]){
   let v=M.get(r.params,f.key),type=f.type;
   if(type==='percent'&&v!=null)v=+(v*100).toFixed(6);
   if(type==='steps')v=(v||[]).join(', ');
   if(type==='percentList')v=(v||[]).map(n=>+(n*100).toFixed(4)).join('; ');
   let opts=type==='select'?f.options.map((o,i)=>[o,f.labels?f.labels[i]:o||'Не применяется']):null;
   if(r.kind==='tranche'&&f.key==='tranches')opts=[['','По согласованию'],...opts];
   html+=field(f.label,'p:'+f.key,v,type==='boolean'?'checkbox':type==='date'?'date':'text',false,opts);
 }
 html+=field('Оформление по программе до','validUntil',r.params.validUntil,'date',true);
 if(r.kind==='installment')html+='<div class="tools-field wide">Промежуточные платежи<div id="tools-milestones" class="tools-milestones"></div><button type="button" id="tools-add-stage" class="t-btn">Добавить платёж</button><small>Укажите сумму и дату платежа. Остаток рассчитывается автоматически.</small></div>';
 $('tools-editor-fields').innerHTML=html;
 const form=$('tools-form');
 form.elements.kind.disabled=!isNew||kinds.length<2;
 form.elements.project.disabled=!isNew;
 form.elements.category.disabled=!isNew&&r.kind!=='info';
 if(!isNew&&!form.elements.category.disabled)form.elements.category.options[0].disabled=true;
 form.elements.project.required=form.elements.category.required=true;
 if(!isNew){
   for(const key of ['project','category','kind']){
     if(form.elements[key].disabled)form.elements[key].closest('label').hidden=true;
   }
 }else if(kinds.length<2)form.elements.kind.closest('label').hidden=true;
 if(r.kind==='installment')(r.params.milestones||[]).forEach(addStage);
 SMToolsForm.mount(form,r,data.records);
 function switchFields(event){
   const previousCategory=r.category,previousKind=r.kind;
   const nextCategory=form.elements.category.value;
   const options=kindsByCategory[nextCategory]||[];
   const kind=event.target.name==='category'?(isNew?options[0]:'info'):form.elements.kind.value;
   try{
     // Сохраняем введённые условия при переключении вида записи туда и обратно.
     r.params=SMToolsForm.readParams(form,r);
     editorDrafts.set(previousKind,M.clone(r.params));
     for(const key of ['name','project','description','combination','mode'])r[key]=form.elements[key].value;
     r.category=nextCategory;
     if(kind!==r.kind){
       const ownerOnly=r.params.ownerOnly;
       r.kind=kind;
       r.params=M.clone(editorDrafts.get(kind)||defaults(kind));
       if(ownerOnly)r.params.ownerOnly=true;else delete r.params.ownerOnly;
     }
     editorFields(r,isNew);
     form.elements[event.target.name].focus();
   }catch(error){
     form.elements.category.value=previousCategory;
     form.elements.kind.value=previousKind;
     $('tools-form-error').textContent=error.message;
   }
 }
 form.elements.category.onchange=form.elements.kind.onchange=switchFields;
 if($('tools-add-stage'))$('tools-add-stage').onclick=()=>addStage({});
}
function defaults(kind){
 if(kind==='mortgage')return {type:'Базовая ипотека',term:30,subsidy:0};
 if(kind==='installment')return {scheme:'deferred'};
 if(kind==='tranche')return {tranches:2};
 if(kind==='discount')return {scope:'cash'};
 return {};
}
function addStage(stage){
 const row=document.createElement('div');
 row.className='tools-milestone';
 row.dataset.originalDate=stage.date||'';
 row.innerHTML='<label class="tools-field"><span class="tools-field-title">Размер платежа</span><select data-stage="amountMode"><option value="amount">Сумма, ₽</option><option value="share">Доля цены, %</option></select></label>'
   +'<label class="tools-field"><span class="tools-field-title">Сумма платежа, ₽</span><input data-stage="amount" inputmode="numeric" value="'+esc(stage.amount||'')+'"></label>'
   +'<label class="tools-field"><span class="tools-field-title">Доля цены, %</span><input data-stage="share" inputmode="decimal" value="'+esc(stage.share?+(stage.share*100).toFixed(4):'')+'"></label>'
   +'<label class="tools-field"><span class="tools-field-title">Когда платить</span><select data-stage="mode"><option value="date">В дату</option><option value="months">Через несколько месяцев</option></select></label>'
   +'<label class="tools-field"><span class="tools-field-title">Дата платежа</span><input data-stage="date" type="date" value="'+esc(stage.date?(stage.date.length===7?stage.date+'-01':stage.date):'')+'"></label>'
   +'<label class="tools-field"><span class="tools-field-title">Месяцев от сделки</span><input data-stage="months" type="number" min="1" max="60" value="'+esc(stage.months||'')+'"></label>'
   +'<button type="button" class="t-icon" aria-label="Убрать платёж">'+icon('x-lg')+'</button>';
 const mode=row.querySelector('[data-stage="mode"]'),amountMode=row.querySelector('[data-stage="amountMode"]');
 mode.value=stage.months?'months':'date';
 amountMode.value=stage.share?'share':'amount';
 const refresh=()=>{
   for(const key of ['amount','share','date','months']){
     const input=row.querySelector('[data-stage="'+key+'"]');
     const selected=key===mode.value||key===amountMode.value;
     input.required=selected;
     input.closest('label').hidden=!selected;
   }
 };
 mode.onchange=amountMode.onchange=refresh;
 refresh();
 row.querySelector('button').onclick=()=>row.remove();
 $('tools-milestones').append(row);
}
var proposalEdit=null;
function activeInProject(template,projectKey){
 return data.records.find(r=>r.enabled&&r.group===template.group&&M.section(r)===M.section(template)&&r.project===projectKey);
}
function addProjectConditions(templateId,targetProject){
 if(!Object.hasOwn(names,targetProject))return;
 const template=data.records.find(r=>r.id===templateId&&r.enabled);
 if(!template){alert('Образец больше не действует. Обновите каталог.');return;}
 const existing=activeInProject(template,targetProject);
 if(existing){editRecord(existing.id);return;}
 const draft=copyAsNew(template);
 draft.project=targetProject;
 draft.category=M.section(template);
 openEditor(null,draft,false,true);
}
function openEditor(id,draft,newProposal,projectConditions){
 editorDrafts=new Map();
 if(draft||id){
   editing=M.clone(draft||data.records.find(r=>r.id===id));
 }else{
   var kind=(kindsByCategory[category]||[])[0];
   editing={id:'tool-'+crypto.randomUUID(),group:'group-'+crypto.randomUUID(),name:'',
     project:project==='all'?'':project,category:category==='all'?'':category,kind:kind,params:defaults(kind),
     description:'',combination:'',mode:'additive',enabled:true};
 }
 $('tools-editor-title').textContent=projectConditions?'Добавить условия · '+editing.name:id?editing.name:'Новый инструмент';
 $('tools-editor-project').textContent=[names[editing.project]||'Черновик инструмента',editing.params.ownerOnly?'Только владельцу':''].filter(Boolean).join(' · ');
 $('tools-form-error').textContent='';
 $('tools-form').querySelector('button[type=submit]').textContent=proposalEdit?'Обновить предложение':'В черновик';
 editorFields(editing,!id||newProposal);
 if(projectConditions){
  const form=$('tools-form');
  for(const field of ['project','category','kind']){
    form.elements[field].disabled=true;
    form.elements[field].closest('label').hidden=true;
  }
  const context=form.querySelector('.tools-form-context');
  if(context)context.hidden=true;
 }
 $('tools-editor').showModal();
}
function copyAsNew(source){
 const draft=M.clone(source);
 draft.id='tool-'+crypto.randomUUID();
 draft.enabled=true;
 delete draft.source;
 delete draft.params.appManaged;
 delete draft.params.subsidyOrigin;
 return draft;
}
function duplicateRecord(id){
 const source=data.records.find(record=>record.id===id);
 if(!source)return;
 const draft=copyAsNew(source);
 draft.group='group-'+crypto.randomUUID();
 draft.name='Копия · '+source.name;
 openEditor(null,draft,true);
 $('tools-editor-title').textContent='Копия инструмента';
 $('tools-form').querySelector('button[type=submit]').textContent='В черновик';
}
$('tools-form').onsubmit=async function(e){e.preventDefault();if(busy)return;busy=true;var submit=e.currentTarget.querySelector('button[type=submit]');submit.disabled=true;$('tools-close').disabled=$('tools-cancel').disabled=true;try{var form=e.currentTarget,r=M.clone(editing);
 for(const key of ['name','project','kind','category','description','combination','mode'])r[key]=form.elements[key].value;
 if(!M.fields[r.kind])throw Error('Выберите раздел и тип записи.');
 r.params=SMToolsForm.readParams(form,editing);
 r.combination='';
 if(!r.name.trim())r.name=SMToolsForm.suggestedName(form,r);
 M.validateRecord(r);
 var p=r.params;
 if(editing.source==='subsidies'){
   const bankParams=params=>Object.fromEntries(Object.entries(params).filter(([key])=>key!=='compatiblePromotions'));
   if(JSON.stringify(bankParams(p))!==JSON.stringify(bankParams(editing.params)))r=takeOwnership(r);
 }else if(r.kind==='mortgage'&&(p.type==='Семейная ипотека'||p.variant==='субсидированная ставка'))r=takeOwnership(r);
 var original=baseline.records.find(function(item){return item.id===r.id;});
 if(!proposalEdit&&(editing.source==='subsidies'||!original||['name','description','combination'].some(function(k){return r[k]!==original[k];}))){
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
 M.cleanCompatibility(candidate);M.validate(candidate);data=candidate;
 for(const id of changes.keys()){const current=data.records.find(item=>item.id===id);if(current)changes.set(id,current);}
 var original=baseline.records.find(x=>x.id===r.id);
 if(JSON.stringify(r)===JSON.stringify(original))changes.delete(r.id);else changes.set(r.id,data.records.find(item=>item.id===r.id));
 render();
}
$('tools-rows').onclick=function(e){var b=e.target.closest('button');if(!b||busy)return;
 if(b.hasAttribute('data-mortgage-general')){
  generalMortgageOpen=!generalMortgageOpen;
  render();
  $('tools-rows').querySelector('[data-mortgage-general]').focus();
  return;
 }
 if(b.dataset.mortgageType){
  const key=b.dataset.mortgageType;
  if(expandedMortgages.has(key))expandedMortgages.delete(key);else expandedMortgages.add(key);
  render();
  $('tools-rows').querySelector('[data-mortgage-type="'+key+'"]').focus();
  return;
 }
 if(b.dataset.copy&&local){duplicateRecord(b.dataset.copy);return;}if(b.dataset.toggle&&local){
 var record=data.records.find(r=>r.id===b.dataset.toggle);
 if(record){
  try{
   const draft=M.clone(record);
   draft.enabled=!record.enabled;
   stageRecord(draft);alert('');
  }catch(err){alert(err.message);}
 }
 return;
}if(b.dataset.newProject){
 if(local)addProjectConditions(b.dataset.template,b.dataset.newProject);
 else ownerAction('add-project',b.dataset.template,b.dataset.newProject);
 return;
}if(b.dataset.edit){if(local)editRecord(b.dataset.edit);else ownerAction('edit',b.dataset.edit);}if(b.dataset.category){collapsed[b.dataset.category]=!collapsed[b.dataset.category];render();}};
$('tools-reset').onclick=function(){if(confirm('Отменить несохранённые изменения?')){data=M.clone(baseline);changes.clear();alert('');render();}};
async function api(path,body){
 if(body&&needsRefresh)throw Error('Изменения уже сохранены, но версию каталога не удалось проверить. Нажмите «Обновить», прежде чем отправлять следующую правку.');
 var res=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf,'X-Editor-Session':csrf}:{'X-Editor-Session':csrf},body:body?JSON.stringify(body):undefined,cache:'no-store'}),j=await res.json();
 if(!res.ok)throw Error(j.error||'Не удалось выполнить запрос.');
 if(j.refreshRequired){needsRefresh=true;pendingPublish=!j.published;throw Error('Изменения сохранены. '+(j.error||'Нажмите «Обновить», чтобы перечитать каталог.'));}
 return j;
}
function accepted(d){M.validate(d);needsRefresh=false;data=M.clone(d);baseline=M.clone(d);revision=d.revision;changes.clear();status();render();}
$('tools-reload').onclick=async function(){if(changes.size&&!confirm('Обновить каталог и отменить несохранённые изменения?'))return;try{busy=true;render();accepted(await api('/api/tools'));alert('');}catch(e){alert(e.message);}finally{busy=false;render();}};
async function save(publishOnly){if(busy)return;busy=true;render();alert('');try{var res=await api(publishOnly?'/api/publish':'/api/events/tools-changed',publishOnly?{}:{revision:revision,changes:Array.from(changes.values())});accepted(res.data);pendingPublish=!res.published;alert(res.published?'Сохранено. Публичный сайт обновится после сборки GitHub Pages, обычно за 1–2 минуты.'+(res.error?' '+res.error:''):'Изменения сохранены. Публикация не завершена. '+res.error);}catch(e){alert(e.message);}finally{busy=false;render();}}
$('tools-save').onclick=function(){save(false);};$('tools-publish').onclick=function(){save(true);};
window.addEventListener('beforeunload',function(e){if(changes.size){e.preventDefault();e.returnValue='';}});
function pdfChunks(g){var records=Object.values(g.cells).flat(),max=Math.max(1,...records.map(function(r){return Math.ceil(r.description.length/550);})),out=[];for(var i=0;i<max;i++){var copy={name:g.name+(i?' · продолжение':''),category:g.category,cells:{}};Object.keys(g.cells).forEach(function(p){copy.cells[p]=g.cells[p].filter(function(r){return i===0||r.description.length>i*550;}).map(function(r){var c=M.clone(r);c.description=r.description.slice(i*550,(i+1)*550);if(i){c.kind='info';c.combination='';}return c;});});out.push(copy);}return out;}
function pdfPages(png){var pages=[],page,tbody,host=document.createElement('div');host.style.cssText='position:absolute;left:-20000px;top:0;width:1123px';document.body.appendChild(host);var section='',count=0;
 function next(){page=U.page(U.reportHead('Инструменты',projects().map(function(p){return names[p];}).join(' · ')+' · '+new Date(data.full_checked_at||data.checked_at).toLocaleDateString('ru-RU'),png)+'<table class="tools-table"><thead>'+header()+'</thead><tbody></tbody></table><p class="tools-legal">Предварительные условия. Применимость и сочетание акций подтверждаются перед сделкой.</p>','landscape');page.classList.add('tools-pdf');page.style.width='1123px';page.style.minHeight='0';host.appendChild(page);pages.push(page);tbody=page.querySelector('tbody');count=0;}
 function addCategory(cat){tbody.insertAdjacentHTML('beforeend','<tr class="tools-section"><td colspan="'+(1+projects().length*2)+'">'+esc(M.categories[cat])+'</td></tr>');}
 var groups=filtered(true);next();try{Object.keys(M.categories).forEach(function(cat){var list=groups.filter(function(g){return g.category===cat;});if(!list.length)return;list.flatMap(pdfChunks).forEach(function(g){if(section!==cat){section=cat;addCategory(cat);}var node=document.createElement('tbody');node.innerHTML=reportRow(g);var tr=node.firstChild;tbody.appendChild(tr);if(page.scrollHeight>750&&count){tr.remove();if(tbody.lastChild&&tbody.lastChild.classList.contains('tools-section'))tbody.lastChild.remove();next();addCategory(cat);tbody.appendChild(tr);}count++;});});pages.forEach(function(p,i){p.querySelector('.tools-legal').textContent+=' · '+(i+1)+' / '+pages.length;p.style.minHeight='794px';p.remove();});return {pages:pages,file:'Инструменты '+projects().map(function(p){return names[p];}).join(' ')+' '+new Date().toLocaleDateString('ru-RU')};}finally{host.remove();}}
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
   items.forEach(g=>body.insertAdjacentHTML('beforeend',reportRow(g)));
 });
 host.appendChild(table);
});
window.addEventListener('afterprint',function(){$('tools-print').replaceChildren();});
Object.entries(M.categories).forEach(function([key,label]){$('tools-category').add(new Option(label,key));});
var params=new URLSearchParams(location.search);
if(Object.hasOwn(names,params.get('project')))selectProject(params.get('project'));
if(Object.hasOwn(M.categories,params.get('section')))category=$('tools-category').value=params.get('section');
if(params.has('query'))$('tools-search').value=params.get('query');
function ownerAction(kind,id,targetProject){
 const record=id&&data?.records.find(r=>r.id===id);
 const titles={'add-project':'Добавить условия · '+names[targetProject],manage:'Управление инструментами',flats:'Квартиры',compensation:'Дополнительные условия',new:'Добавить инструмент',ai:'Добавить с ИИ',edit:record?.name||'Редактировать инструмент'};
 const flatFilter=kind==='flats'?settingsEditor.flatFilter():undefined;
 const sections={collapsed:Object.keys(collapsed).filter(key=>collapsed[key]),mortgages:[...expandedMortgages],general:generalMortgageOpen};
 SMOwnerWindow.open({kind,id,flatFilter,sections,query:$('tools-search').value,project:targetProject||record?.project||project,section:record?M.section(record):category},titles[kind]);
}
$('tools-owner-link').onclick=()=>ownerAction('manage');
await window.SM_TOOLS_READY;
if(!window.SM_TOOLS_DATA){SMOwnerWindow.failed(window.SM_TOOLS_STATUS?.error);alert('Справочник не загрузился. '+(window.SM_TOOLS_STATUS?.error||'Обновите страницу.'));$('tools-status').textContent='Источник недоступен';$('tools-pdf').disabled=true;$('tools-rows').innerHTML='';return;}
if(local){
 window.SMProposals.setup({api:function(path,body){
   if(path==='/api/ai/propose'){
     var context=[project==='all'?'':'Проект: '+names[project],category==='all'?'':'Раздел: '+M.categories[category]].filter(Boolean);
     if(context.length)body={...body,text:'Выбрано в каталоге: '+context.join(' · ')+'.\n'+body.text};
   }
   return api(path,body);
 },csrf:function(){return csrf;},model:M,names:names,kinds:kindNames,
 revision:function(){return revision;},edit:function(record,isNew,done){proposalEdit=done;openEditor(record.id,record,isNew);},
 applied:function(res){
   var pending=Array.from(changes.values());accepted(res.data);
   pending.forEach(function(r){var i=data.records.findIndex(function(x){return x.id===r.id;});if(i<0)data.records.push(r);else data.records[i]=r;changes.set(r.id,data.records.find(item=>item.id===r.id));});
   pendingPublish=!res.published;render();alert(res.published?'Выбранные предложения сохранены. Сайт обновится после сборки.'+(res.error?' '+res.error:''):'Изменения сохранены. Публикация не завершена. '+res.error);
 },pending:function(){return Array.from(changes.keys());}});
 $('tools-editor').addEventListener('close',function(){proposalEdit=null;});
 var session=window.SM_TOOLS_SESSION;csrf=session.csrf;$('tools-add').hidden=false;$('tools-owner').hidden=true;$('tools-inactive-label').hidden=false;}
const linkedType=params.get('mortgageType');
const showLinkedType=category==='mortgage'&&Object.hasOwn(M.mortgageTypes,linkedType)
 &&!params.has('edit')&&!location.hash;
if(showLinkedType)expandedMortgages.add(linkedType);
accepted(window.SM_TOOLS_DATA);
settingsEditor=SMToolsSettings.setup({
 getData:()=>data, mount:$('tools-settings-panel'), readOnly:!local,
 api:local?api:async()=>({revision:data.checked_at,settings:data.settings}),
 canSave:()=>!busy&&!changes.size,
 onSaved:res=>{accepted(res.data);pendingPublish=!res.published;render();}
});
function selectView(next, addHistory=false){
 view=['flats','compensation'].includes(next)?next:'catalog';
 const title={catalog:'Инструменты',flats:'Квартиры',compensation:'Дополнительные условия'}[view];
 document.querySelector('.tools-mast h1').textContent=title;document.title=title+' — Свобода мысли';
 $('tools-catalog-panel').hidden=view!=='catalog';$('tools-settings-panel').hidden=view==='catalog';
 $('tools-settings-owner').hidden=local||view==='catalog';
 $('tools-settings-edit').textContent=view==='flats'?'Редактировать условия квартир':'Редактировать условия';
 document.querySelectorAll('[data-tools-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.toolsView===view)));
 if(view!=='catalog')settingsEditor.show(view);
 SMOwnerWindow.viewChanged?.(view);
 const url=new URL(location.href);if(view==='catalog')url.searchParams.delete('view');else url.searchParams.set('view',view);
 if(addHistory && !SMOwnerWindow.embedded && url.href!==location.href)history.pushState(null,'',url);
 else history.replaceState(null,'',url);
 render();
}
document.querySelector('.tools-view-tabs').onclick=e=>{const button=e.target.closest('[data-tools-view]');if(button){document.documentElement.classList.toggle('sm-tools-switching',e.detail>0);selectView(button.dataset.toolsView,true);}};
$('tools-settings-edit').onclick=()=>ownerAction(view);
window.addEventListener('popstate',()=>selectView(new URL(location.href).searchParams.get('view')));
selectView(params.get('view'));


if(showLinkedType)requestAnimationFrame(()=>$('mortgage-type-'+linkedType)?.scrollIntoView({block:'start'}));
let lastPartnerFilters;
SMOwnerWindow.ready(function(action){
 if(!action||!['manage','new','edit','ai','add-project','flats','compensation'].includes(action.kind))return;
 // При повторном входе оставляем фильтры редактора, пока не изменился выбор в просмотре.
 const partnerFilters=JSON.stringify([action.project,action.section,action.query,action.sections]);
 if(action.kind!=='manage'||partnerFilters!==lastPartnerFilters){
   selectProject(Object.hasOwn(names,action.project)?action.project:'all');
   category=$('tools-category').value=Object.hasOwn(M.categories,action.section)?action.section:'all';
   $('tools-search').value=typeof action.query==='string'?action.query:'';
   $('tools-inactive').value='active';
   collapsed={};
   expandedMortgages.clear();
   for(const key of action.sections?.collapsed||[])if(Object.hasOwn(M.categories,key))collapsed[key]=true;
   for(const key of action.sections?.mortgages||[])if(Object.hasOwn(M.mortgageTypes,key))expandedMortgages.add(key);
   generalMortgageOpen=action.sections?.general===true;
 }
 lastPartnerFilters=partnerFilters;
 selectView(['flats','compensation'].includes(action.kind)?action.kind:'catalog');
 if(action.kind==='flats' && action.flatFilter)settingsEditor.setFlatFilter(action.flatFilter);
 if(action.kind==='add-project')addProjectConditions(action.id,action.project);
 if(action.kind==='edit')editRecord(action.id);
 if(action.kind==='new')openEditor();
 if(action.kind==='ai')$('tools-ai').click();
});
if(local && !SMOwnerWindow.embedded){
 $('owner-return').hidden=false;
 $('owner-return').onclick=()=>{
   const target=new URL(location.href);
   for(const key of ['edit','template','mode'])target.searchParams.delete(key);
   target.hash='';
   location.replace(target.href);
 };
}
if(local && params.has('template')){
 const template=params.get('template');
 params.delete('template');
 history.replaceState(null,'',location.pathname+'?'+params.toString());
 addProjectConditions(template,project);
}
if(local && params.has('edit')){
 const id=params.get('edit');
 params.delete('edit');
 history.replaceState(null,'',location.pathname+'?'+params.toString());
 editRecord(id);
}
if(local && (location.hash==='#new'||location.hash==='#ai')){
 var action=location.hash==='#new'?'tools-add':'tools-ai';
 history.replaceState(null,'',location.pathname+location.search);
 $(action).click();
}
window.SMToolsMortgageNotices(function(){return data;});
if(data.writeNotice)alert(data.writeNotice);
})();
