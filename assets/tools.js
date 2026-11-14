(async function(){
'use strict';
var M=SMToolsModel,U=SMUi,esc=U.esc,$=function(id){return document.getElementById(id);},local=location.hostname==='127.0.0.1'&&location.port==='8795';
var data,baseline,revision,csrf,project='all',category='all',collapsed={},changes=new Map(),editing=null,busy=false,pendingPublish=false;
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
  if(p.pay)lines.push('Студия / 1к: '+M.rub(p.pay[1])+' · 2к: '+M.rub(p.pay[2])+' · 3к: '+M.rub(p.pay[3]));
  if(p.steps)lines.push('Платежи каждые '+p.steps.join(' / ')+' мес.');
  if(p.maxDisc!=null)lines.push('Потолок скидки '+M.pct(p.maxDisc));
  if(p.pvChoices)lines.push('Варианты ПВ: '+p.pvChoices.map(M.pct).join(' / '));
  if(p.discAt70!=null)lines.push('При ПВ от 70% скидка '+M.pct(p.discAt70));
  (p.milestones||[]).forEach(m=>lines.push(M.pct(m.share)+' — '+(m.date||'через '+m.months+' мес.')));
 }
 if(r.kind!=='info'&&r.description)lines.push(r.description);
 return lines;
}
function reportRow(g){
 const cells=projects().map(key=>{
  const records=g.cells[key]||[];
  const terms=records.map(r=>'<div class="tools-cell">'+(r.name!==g.name?'<strong>'+esc(r.name)+'</strong>':'')+
   reportCell(r).map(line=>'<p>'+esc(line)+'</p>').join('')+'</div>').join('');
  const combination=records.map(r=>'<div class="tools-cell"><p>'+esc(r.combination||M.modes[r.mode])+'</p>'+
   (r.combination&&r.combination!==M.modes[r.mode]?'<span class="tools-tag">'+esc(M.modes[r.mode])+'</span>':'')+'</div>').join('');
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
   const terms=[p.pvChoices?'ПВ '+p.pvChoices.map(M.pct).join(' / '):'ПВ от '+M.pct(p.minPv)];
   if(p.discAt70!=null)terms.push('скидка '+M.pct(p.disc||0)+'–'+M.pct(p.discAt70));
   else if(p.discFromPv)terms.push('скидка '+M.pct(p.discFromPv)+' на ПВ');
   else if(p.disc)terms.push('скидка '+M.pct(p.disc));
   else if(p.pay)terms.push('от '+M.rub(Math.min(...Object.values(p.pay)))+'/мес.');
   return terms.join(' · ');
  }
  default: {
   const line=r.description.trim().split(/\r?\n/)[0];
   return line.length>78 ? line.slice(0,77).replace(/\s+\S*$/,'')+'…' : line||'Условия не указаны';
  }
 }
}

function editAction(r){
 const label='Редактировать';
 const aria=esc(label+' · '+r.name+' · '+names[r.project]);
 return '<button type="button" class="tool-record-edit" aria-label="'+aria+'" data-edit="'+r.id+'">'+icon('pencil')+label+'</button>';
}

function compactCell(r){
 const lines=reportCell(r);
 const p=r.params;
 if(r.mode&&r.combination.trim()!==M.modes[r.mode])lines.push('Правило сочетания: '+M.modes[r.mode]);
 if(r.params.appManaged)lines.push('Условия ведутся в приложении');
 if(r.source==='subsidies')lines.push('Из справочника субсидий '+(r.project==='dnk2'?'ДНК':'ДА'));
 if(local&&r.kind==='mortgage')lines.push('Комиссия банку '+M.pct(p.subsidy));
 if(r.combination.trim()&&r.combination.trim()!=='-')lines.push('Сочетание: '+r.combination.trim());
 const copy=local?'<button type="button" class="tools-add-cell" data-copy="'+r.id+'">Создать копию</button>':'';
 const archive=local?'<button type="button" class="tools-add-cell" data-toggle="'+r.id+'">'+(r.source==='subsidies'?'Вести здесь и архивировать':r.enabled?'В архив':'Восстановить')+'</button>':'';
 return '<article class="tool-entry" data-record="'+r.id+'">'+(p.ownerOnly?'<span class="tools-tag tools-private">Только владельцу</span>':'')+
   '<p class="tool-brief">'+esc(brief(r))+'</p><div class="tool-entry-actions"><details><summary>Подробнее</summary><div class="tool-full">'+
   [...new Set(lines)].filter(Boolean).map(line=>'<p>'+esc(line)+'</p>').join('')+'<div class="tool-secondary">'+copy+archive+'</div></div></details>'+editAction(r)+'</div></article>';
}

function compactRow(group){
 const cells=projects().map(projectKey=>{
  const records=group.cells[projectKey]||[];
  let contents=records.map(r=>(r.name!==group.name?'<strong>'+esc(r.name)+'</strong>':'')+compactCell(r)).join('');
  if(!records.length && local && $('tools-inactive').value==='active' && !Object.values(group.cells).flat().some(r=>r.source==='subsidies')){
   contents='<button type="button" class="tools-add-cell" data-new-project="'+projectKey+'" data-group="'+group.id+'">Добавить условия</button>';
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
 $('tools-savebar').hidden=!local;
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
 $('ai-context').textContent='Выбрано в каталоге: '+(names[project]||'все проекты')+' · '+(M.categories[category]||'все разделы');

}
function status(){var date=data.full_checked_at||data.checked_at;$('tools-status').textContent=(local?'Личный редактор · ':'')+'Проверено '+new Date(date).toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg',dateStyle:'short',timeStyle:'short'})+' · Екатеринбург';if(Date.now()-Date.parse(date)>8*86400000)alert('Справочник не проверялся больше недели. Подтвердите условия перед отправкой партнёрам.');}
function field(label,name,value,type,wide,options){var s='<label class="tools-field'+(wide?' wide':'')+'">'+esc(label);if(options)s+='<select name="'+name+'">'+options.map(function(o){var v=typeof o==='string'?o:o[0],l=typeof o==='string'?o:o[1];return '<option value="'+esc(v)+'"'+(String(value)===v?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select>';else if(type==='textarea')s+='<textarea name="'+name+'">'+esc(value||'')+'</textarea>';else s+='<input name="'+name+'" type="'+(type||'text')+'"'+(type==='checkbox'?(value?' checked':''):' value="'+esc(value==null?'':value)+'"')+'>';return s+'</label>';}
var kindsByCategory={mortgage:['mortgage','info'],installment:['installment','info'],tranche:['tranche','info'],chpv:['chpv','info'],discount:['info','discount'],extra:['info'],booking:['info']};
function editorFields(r,isNew){
 var section=M.section(r),kinds=kindsByCategory[section]||[];
 var html=field('Проект','project',r.project,'select',false,[['','Выберите проект'],...Object.entries(names)])
   +field('Раздел','category',section,'select',false,[['','Выберите раздел'],...Object.entries(M.categories)])
   +field('Название','name',r.name,'text',true)
   +field('Механика расчёта','kind',r.kind,'select',true,kinds.length?kinds.map(k=>[k,kindNames[k]]):[['','Сначала выберите раздел']]);
 html+=field('Условия инструмента','description',r.description,'textarea',true)+field('Сочетание с акциями','combination',r.combination,'textarea',true)+field('Правило сочетания','mode',r.mode,'select',true,Object.entries(M.modes));
 if(isNew&&!proposalEdit)html+=field('Кому виден инструмент','visibility',r.params.ownerOnly?'private':'public','select',true,[['public','Партнёрам'],['private','Только мне']]);
 if(r.source==='subsidies')html+='<p class="tools-ownership-note">После сохранения вы ведёте эту программу здесь. Импорт больше не меняет её условия.</p>';
 const hasParams=!!r.kind;
 if(hasParams)html+='<details class="tools-param-panel"><summary>Параметры расчёта</summary><div class="tools-param-grid">';
 (M.fields[r.kind]||[]).forEach(function(f){var v=M.get(r.params,f.key),type=f.type;if(type==='percent'&&v!=null)v=+(v*100).toFixed(6);if(type==='steps')v=(v||[]).join(', ');if(type==='percentList')v=(v||[]).map(function(n){return +(n*100).toFixed(4);}).join('; ');var opts=type==='select'?f.options.map(function(o,i){return [o,f.labels?f.labels[i]:o||'Не применяется'];}):null;if(r.kind==='tranche'&&f.key==='tranches')opts=[['','По согласованию'],...opts];html+=field(f.label,'p:'+f.key,v,type==='boolean'?'checkbox':type==='date'?'date':'text',false,opts);});
 if(hasParams)html+=field('Условия действуют до','validUntil',r.params.validUntil,'date',true);
 if(r.kind==='installment'){html+='<div class="tools-field wide">Промежуточные этапы (% от стоимости)<div id="tools-milestones" class="tools-milestones"></div><button type="button" id="tools-add-stage" class="t-btn">Добавить этап</button><small>Для этапа укажите дату или количество месяцев после сделки. Остаток рассчитывается автоматически.</small></div>';}
 if(hasParams)html+='</div></details>';
 $('tools-editor-fields').innerHTML=html;var form=$('tools-form');form.elements.kind.disabled=!isNew||kinds.length<2;
 form.elements.project.disabled=!isNew;form.elements.category.disabled=!isNew&&r.kind!=='info';
 if(!isNew&&!form.elements.category.disabled)form.elements.category.options[0].disabled=true;
 form.elements.name.required=form.elements.project.required=form.elements.category.required=true;
 if(!isNew){
  // Проект указан в заголовке. Редактируемые условия идут сразу за названием.
  ['project','category','kind'].forEach(key=>{
   const input=form.elements[key];
   if(input.disabled)input.closest('label').hidden=true;
  });
 }
 const mainFields={
  mortgage:['bank','type','kids','term','rate','subsidy','minPv','limit'],
  installment:['minPv',r.params.discFromPv?'discFromPv':'disc'],
  tranche:['minPv',r.params.estimate?'referencePayment':'rate'],
  chpv:['rate','limit'],discount:['percent']
 };
 const keys=r.kind==='mortgage'&&!isNew?['rate','minPv','subsidy']:mainFields[r.kind]||[];
 const description=form.elements.description.closest('label');
 for(const key of keys){
  const input=form.elements['p:'+key];
  if(input)description.before(input.closest('label'));
 }
 if(r.kind==='installment')(r.params.milestones||[]).forEach(addStage);
 function switchFields(event){
   if(form.elements.visibility){if(form.elements.visibility.value==='private')r.params.ownerOnly=true;else delete r.params.ownerOnly;}
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
   editing=Object.assign(copyAsNew(template),{project:targetProject});
 }else{
   var kind=(kindsByCategory[category]||[])[0];
   editing={id:'tool-'+crypto.randomUUID(),group:'group-'+crypto.randomUUID(),name:'',
     project:project==='all'?'':project,category:category==='all'?'':category,kind:kind,params:defaults(kind),
     description:'',combination:'',mode:'none',enabled:true};
 }
 $('tools-editor-title').textContent=id?editing.name:'Новый инструмент';
 $('tools-editor-project').textContent=[names[editing.project]||'Черновик инструмента',editing.params.ownerOnly?'Только владельцу':''].filter(Boolean).join(' · ');
 $('tools-form-error').textContent='';
 $('tools-form').querySelector('button[type=submit]').textContent=draft?'Обновить предложение':editing.source==='subsidies'?'Вести в приложении · в черновик':'В черновик';
 editorFields(editing,!id||newProposal);
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
 openEditor(null,null,null,draft,true);
 $('tools-editor-title').textContent='Копия инструмента';
 $('tools-form').querySelector('button[type=submit]').textContent='В черновик';
}
function numeric(value,label){var s=value.trim().replace(/\s/g,'').replace(',','.');if(!/^(?:\d+)(?:\.\d+)?$/.test(s))throw Error(label+': введите число.');return Number(s);}
$('tools-form').onsubmit=async function(e){e.preventDefault();if(busy)return;busy=true;var submit=e.currentTarget.querySelector('button[type=submit]');submit.disabled=true;$('tools-close').disabled=$('tools-cancel').disabled=true;try{var form=e.currentTarget,r=M.clone(editing),p=M.clone(r.params);['name','project','kind','category','description','combination','mode'].forEach(function(k){r[k]=form.elements[k].value;});
 if(!M.fields[r.kind])throw Error('Выберите раздел и механику расчёта.');
 M.fields[r.kind].forEach(function(f){var input=form.elements['p:'+f.key],v=input.value.trim();if(f.type==='boolean'){if(!input.checked&&M.get(p,f.key)==null)return;v=input.checked;}else if(v===''){if(f.key.includes('.')){var keys=f.key.split('.');if(p[keys[0]])delete p[keys[0]][keys[1]];}else delete p[f.key];return;}else if(['integer','money','percent'].includes(f.type)){v=numeric(v,f.label);if(f.type==='percent'){const previous=M.get(editing.params,f.key);v=previous!=null&&v===+(previous*100).toFixed(6)?previous:v/100;}}else if(['steps','percentList'].includes(f.type)){v=v.split(f.type==='steps'?/[,;]+/:/;/).map(function(s){return numeric(s,f.label)/(f.type==='percentList'?100:1);});}M.set(p,f.key,v);});
 if(p.pay&&!Object.keys(p.pay).length)delete p.pay;
 if(r.kind==='installment'){var stages=Array.from($('tools-milestones').children).map(function(div){var o={share:numeric(div.querySelector('[data-stage=share]').value,'Доля этапа')/100},date=div.querySelector('[data-stage=date]').value,months=div.querySelector('[data-stage=months]').value;if(date)o.date=date;if(months)o.months=numeric(months,'Месяцев');return o;});if(stages.length)p.milestones=stages;else delete p.milestones;delete p.noExtra;delete p.extraSequential;}
 if(form.elements.validUntil){if(form.elements.validUntil.value)p.validUntil=form.elements.validUntil.value;else delete p.validUntil;}
 if(form.elements.visibility){
  if(form.elements.visibility.value==='private')p.ownerOnly=true;
  else delete p.ownerOnly;
 }
 r.params=p;
 if(editing.source==='subsidies'||(r.kind==='mortgage'&&(p.type==='Семейная ипотека'||p.variant==='субсидированная ставка')))r=takeOwnership(r);
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
 M.validate(candidate);data=candidate;
 var original=baseline.records.find(x=>x.id===r.id);
 if(JSON.stringify(r)===JSON.stringify(original))changes.delete(r.id);else changes.set(r.id,r);
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
   const draft=record.source==='subsidies'?takeOwnership(record):M.clone(record);
   draft.enabled=!record.enabled;
   stageRecord(draft);alert('');
  }catch(err){alert(err.message);}
 }
 return;
}if(b.dataset.newProject&&local){openEditor(null,b.dataset.group,b.dataset.newProject);return;}if(b.dataset.edit){if(local)editRecord(b.dataset.edit);else ownerAction('edit',b.dataset.edit);}if(b.dataset.category){collapsed[b.dataset.category]=!collapsed[b.dataset.category];render();}};
$('tools-reset').onclick=function(){if(confirm('Отменить несохранённые изменения?')){data=M.clone(baseline);changes.clear();alert('');render();}};
async function api(path,body){var res=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf,'X-Editor-Session':csrf}:{'X-Editor-Session':csrf},body:body?JSON.stringify(body):undefined,cache:'no-store'}),j=await res.json();if(!res.ok)throw Error(j.error||'Не удалось выполнить запрос.');return j;}
function accepted(d){M.validate(d);data=M.clone(d);baseline=M.clone(d);revision=d.revision;changes.clear();status();render();}
$('tools-reload').onclick=async function(){if(changes.size&&!confirm('Обновить каталог и отменить несохранённые изменения?'))return;try{busy=true;render();accepted(await api('/api/tools'));alert('');}catch(e){alert(e.message);}finally{busy=false;render();}};
async function save(publishOnly){if(busy)return;busy=true;render();alert('');try{var res=await api(publishOnly?'/api/publish':'/api/events/tools-changed',publishOnly?{}:{revision:revision,changes:Array.from(changes.values())});accepted(res.data);pendingPublish=!res.published;alert(res.published?'Сохранено. Публичный сайт обновится после сборки GitHub Pages, обычно за 1–2 минуты.':'Изменения сохранены. Публикация не завершена. '+res.error);}catch(e){alert(e.message);}finally{busy=false;render();}}
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
function ownerAction(kind,id){
 const record=id&&data?.records.find(r=>r.id===id);
 const titles={manage:'Управление инструментами',new:'Добавить инструмент',ai:'Добавить с ИИ',edit:record?.name||'Редактировать инструмент'};
 SMOwnerWindow.open({kind,id,project:record?.project||project,section:record?M.section(record):category},titles[kind]);
}
$('tools-owner-link').onclick=()=>ownerAction('manage');
$('tools-owner-new').onclick=()=>ownerAction('new');
$('tools-owner-ai').onclick=()=>ownerAction('ai');
await window.SM_TOOLS_READY;
if(!window.SM_TOOLS_DATA){SMOwnerWindow.failed();alert('Справочник не загрузился. Обновите страницу.');$('tools-status').textContent='Источник недоступен';$('tools-pdf').disabled=true;$('tools-rows').innerHTML='';return;}
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
   pendingPublish=!res.published;render();alert(res.published?'Выбранные предложения сохранены. Сайт обновится после сборки.':'Изменения сохранены. Публикация не завершена. '+res.error);
 },pending:function(){return Array.from(changes.keys());}});
 $('tools-editor').addEventListener('close',function(){proposalEdit=null;});
 var session=window.SM_TOOLS_SESSION;csrf=session.csrf;$('tools-add').hidden=false;$('tools-owner').hidden=true;$('tools-inactive-label').hidden=false;}
const linkedType=params.get('mortgageType');
const showLinkedType=category==='mortgage'&&Object.hasOwn(M.mortgageTypes,linkedType)
 &&!params.has('edit')&&!location.hash;
if(showLinkedType)expandedMortgages.add(linkedType);
accepted(window.SM_TOOLS_DATA);
if(showLinkedType)requestAnimationFrame(()=>$('mortgage-type-'+linkedType)?.scrollIntoView({block:'start'}));
SMOwnerWindow.ready(function(action){
 if(!action||!['manage','new','edit','ai'].includes(action.kind))return;
 selectProject(Object.hasOwn(names,action.project)?action.project:'all');
 category=$('tools-category').value=Object.hasOwn(M.categories,action.section)?action.section:'all';
 $('tools-search').value='';
 $('tools-inactive').value='active';
 render();
 if(action.kind==='edit')editRecord(action.id);
 if(action.kind==='new')openEditor();
 if(action.kind==='ai')$('tools-ai').click();
});
if(SMOwnerWindow.embedded){
 const returnIfFinished=()=>{
   if(!changes.size&&!pendingPublish&&!document.querySelector('dialog[open]')) SMOwnerWindow.close();
 };
 $('tools-editor').addEventListener('close',returnIfFinished);
 $('ai-dialog').addEventListener('close',returnIfFinished);
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
