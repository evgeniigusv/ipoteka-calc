/* Предложения владельца остаются черновиками до принятия. */
(function () {
  function setup(options) {
    const $ = id => document.getElementById(id);
    const dialog = $('ai-dialog'), input = $('ai-text'), status = $('ai-status'), M = options.model;
    let items = [], revision = '', busy = false, recording = null, timer;
    function controls() {
      $('ai-build').disabled = busy || !!recording || !input.value.trim();
      $('ai-accept').disabled = busy || !!recording || !items.some(i => i.selected);
      $('ai-mic').disabled = busy;
      $('ai-file').disabled = input.disabled = busy || !!recording;
      $('ai-close').disabled = busy || !!recording;
      $('ai-mic').textContent = recording ? 'Остановить запись' : 'Надиктовать';
    }
    function node(tag, text) {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      return n;
    }
    function show() {
      const list = $('ai-items');
      list.replaceChildren();
      items.forEach(item => {
        const r = item.record, section = node('section'), label = node('label'), check = node('input');
        section.className = 'ai-item';check.type = 'checkbox';check.checked = item.selected;
        check.onchange = () => { item.selected = check.checked; controls(); };
        label.append(check, document.createTextNode(' '+item.action+' · '+options.names[r.project]+' · '+r.name));
        section.append(label);
        const dl = node('dl');
        function field(k, v) { dl.append(node('dt',k),node('dd',v)); }
        field('Вид',options.kinds[r.kind]);field('Условия',r.description);
        field('Сочетание',M.modes[r.mode]+(r.combination?' · '+r.combination:''));
        for(const f of M.fields[r.kind]) {
          let v=M.get(r.params,f.key);
          if(v==null || v==='') continue;
          if(f.type==='percent') v=M.pct(v);
          else if(f.type==='percentList') v=v.map(M.pct).join(' / ');
          else if(f.type==='money') v=M.rub(v);
          else if(f.type==='boolean') v=v?'Да':'Нет';
          else if(f.labels) v=f.labels[f.options.indexOf(String(v))]||v;
          field(f.label,v);
        }
        if(r.params.validUntil) field('Условия действуют до',r.params.validUntil);
        for(const m of r.params.milestones||[]) field('Этап',M.pct(m.share)+' · '+(m.date||('через '+m.months+' мес.')));
        section.append(dl);
        const details=node('details');details.append(node('summary','Основание в исходном тексте'));
        item.quotes.forEach(q=>details.append(node('blockquote',q)));section.append(details);
        const edit=node('button','Редактировать');edit.className='t-btn';edit.type='button';
        edit.onclick=()=>options.edit(r, item.action==='Добавление', async changed=>{
          const result=await options.api('/api/ai/revise',{revision,ticket:item.ticket,previous:r,record:changed});
          item.record=result.record;item.ticket=result.ticket;show();
        });section.append(edit);list.append(section);
      });
      controls();
    }
    function invalidate() {items=[];revision='';status.textContent='';show();}
    async function work(action) {
      if(busy)return;
      busy=true;controls();$('ai-items').inert=true;
      try {await action();} catch(e){status.textContent=e.message;}
      finally {busy=false;$('ai-items').inert=false;controls();}
    }
    async function upload(path,file,headers) {
      const response=await fetch(path,{method:'POST',headers:{'X-CSRF-Token':options.csrf(),...headers},body:file});
      const result=await response.json();if(!response.ok)throw Error(result.error);return result.text;
    }
    function append(text){input.value=[input.value.trim(),text].filter(Boolean).join('\n\n');invalidate();}
    function stop(){if(recording && recording.state!=='inactive') recording.stop();}
    $('tools-ai').hidden=false;
    $('tools-ai').onclick=()=>{dialog.showModal();controls();};
    $('ai-close').onclick=()=>dialog.close();
    dialog.addEventListener('cancel',e=>{if(busy || recording)e.preventDefault();});
    dialog.addEventListener('close',stop);
    input.oninput=invalidate;
    $('ai-file').onchange=e=>{
      const file=e.target.files[0];e.target.value='';if(!file)return;
      work(async()=>{if(file.size>12000000)throw Error('Выберите файл до 12 МБ.');
        status.textContent='Читаю протокол…';append(await upload('/api/ai/document',file,{'X-File-Type':file.name.split('.').pop().toLowerCase()}));
        status.textContent='Текст загружен. Можно подготовить предложения.';});
    };
    $('ai-mic').onclick=()=>{
      if(recording){stop();return;}
      work(async()=>{
        if(!navigator.mediaDevices || !window.MediaRecorder)throw Error('В этом браузере микрофон недоступен. Можно ввести текст.');
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        try {
          const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(v=>MediaRecorder.isTypeSupported(v));
          const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined),parts=[];
          recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
          recorder.onstop=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());recording=null;
            work(async()=>{status.textContent='Расшифровываю запись…';
              append(await upload('/api/ai/audio',new Blob(parts),{'Content-Type':recorder.mimeType.split(';')[0]}));
              status.textContent='Проверьте расшифровку и подготовьте предложения.';});};
          recorder.start();recording=recorder;timer=setTimeout(stop,180000);
          status.textContent='Идёт запись. Назовите проект, инструмент и условия.';controls();
        } catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
      });
    };
    $('ai-build').onclick=()=>work(async()=>{
      invalidate();status.textContent='Разбираю решения и проверяю условия…';
      const result=await options.api('/api/ai/propose',{text:input.value.trim()});
      items=result.items.map(i=>({...i,selected:true}));revision=result.revision;
      status.textContent=[items.length?'Предложений: '+items.length+'. Проверьте условия.':'Готовых предложений нет.',...result.questions].join(' ');
      show();
    });
    $('ai-accept').onclick=()=>work(async()=>{
      const chosen=items.filter(i=>i.selected);
      if(chosen.some(i=>options.pending().includes(i.record.id)))throw Error('Эта же строка уже изменена в ручном черновике. Сначала сохраните ручную правку.');
      if(options.pending().length && options.revision()!==revision)throw Error('Справочник изменился с начала ручного редактирования. Сначала проверьте ручные правки.');
      status.textContent='Сохраняю выбранные предложения…';
      const result=await options.api('/api/ai/accept',{revision,items:chosen.map(i=>({ticket:i.ticket,record:i.record}))});
      options.applied(result);input.value='';invalidate();dialog.close();
    });
    controls();
  }
  window.SMProposals={setup};
})();
