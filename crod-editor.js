(() => {
  const storageKey='crod-database-v1';
  const seed=structuredClone(window.CrodDatabase);
  let revision=0,ready=false,busy=false,editing=null,deleting=null;
  const columns=['สถานี','kV / กลุ่ม','ชื่อจุดวัด MW','PK_POINT MW','ชื่อจุดวัด MV','PK_POINT MV','จังหวัด'];
  const dialog=document.createElement('dialog');dialog.id='crod-editor';dialog.setAttribute('aria-labelledby','db-title');
  dialog.innerHTML=`<div class="db-shell"><div class="db-titlebar"><h2 id="db-title">Database CROD</h2><button type="button" id="db-close">ปิด</button></div>
    <p class="db-description" id="db-storage"></p>
    <div class="db-toolbar"><input id="db-search" type="search" placeholder="ค้นหาสถานี ชื่อจุดวัด รหัส หรือจังหวัด" aria-label="ค้นหา Database CROD"><span id="db-count"></span><button type="button" class="db-primary" id="db-add">เพิ่มรายการ</button><button type="button" id="db-export">สำรองข้อมูล JSON</button></div>
    <p class="db-feedback" id="db-message" role="status"></p>
    <div class="db-delete-confirm" id="db-delete-confirm" hidden><span></span><button type="button" class="db-danger" id="db-delete-yes">ยืนยันลบ</button><button type="button" id="db-delete-no">ยกเลิก</button></div>
    <div class="db-scroll"><table class="db-table"><thead><tr></tr></thead><tbody></tbody></table></div></div>`;
  document.body.append(dialog);
  const find=id=>dialog.querySelector('#'+id),tbody=dialog.querySelector('tbody');
  const headers=['สถานี','kV','ชื่อจุดวัด MW','รหัส MW','ชื่อจุดวัด MV','รหัส MV','จังหวัด','จัดการ'];
  for(const [index,name] of headers.entries()) {const th=document.createElement('th');th.scope='col';th.textContent=name;th.title=columns[index]||name;dialog.querySelector('thead tr').append(th);}
  find('db-storage').textContent=window.crodDatabaseRequest?'บันทึกใน Firebase · ข้อมูลส่วนกลางสำหรับทุกเครื่อง':'บันทึกในเบราว์เซอร์นี้ · ใช้ “สำรองข้อมูล JSON” เพื่อเก็บสำเนา';
  const message=(text,error=false)=>{find('db-message').textContent=text;find('db-message').dataset.error=String(error);};
  function changed(rows) {
    window.CrodDatabase=rows;
    window.dispatchEvent(new Event('crod-database-change'));
  }
  async function load() {
    try {
      const state=window.crodDatabaseRequest ? await window.crodDatabaseRequest('GET') : JSON.parse(localStorage.getItem(storageKey)||'null');
      changed(CrodValidation.validate(state?.rows ?? seed));
      revision=state?.revision ?? 0;ready=true;message('');
    } catch (error) {ready=false;message(error.code==='permission-denied' ? 'ยังไม่มีสิทธิ์อ่านฐานข้อมูล กรุณาเข้าสู่ระบบผู้ดูแล' : (error.message || 'อ่านฐานข้อมูลไม่สำเร็จ กรุณาปิดแล้วเปิด Database CROD อีกครั้ง'),true);}
    render();
  }
  function action(text,fn,style='') {const b=document.createElement('button');b.type='button';b.textContent=text;b.className=style;b.disabled=busy||!ready||!canEdit();b.onclick=fn;return b;}
  const canEdit=()=>!window.crodCanEdit || window.crodCanEdit();
  window.addEventListener('crod-permissions-change',()=>{if(!canEdit())editing=null;if(!ready&&canEdit())load();else render();});
  function render() {
    tbody.replaceChildren();
    const query=find('db-search').value.trim().toLowerCase();
    const data=window.CrodDatabase;
    let count=0;
    function row(values,index) {
      const tr=tbody.insertRow();
      const isEditing=editing===index;
      if(isEditing) tr.dataset.editing='true';
      values.forEach((value,column)=>{
        const td=tr.insertCell();
        if(isEditing) {
          const input=document.createElement('input');input.value=String(value??'');input.maxLength=240;
          input.setAttribute('aria-label',columns[column]);
          if([3,5].includes(column))input.inputMode='numeric';
          input.disabled=busy;td.append(input);
        } else {td.textContent=value;td.title=String(value??'');}
      });
      const td=tr.insertCell();
      if(isEditing) {
        td.append(action('บันทึก',()=>saveRow(tr,index),'db-primary'),action('ยกเลิก',()=>{editing=null;message('');render();}));
      } else {
        const edit=action('แก้ไข',()=>{editing=index;deleting=null;find('db-delete-confirm').hidden=true;render();focusEditor();});
        const remove=action('ลบ',()=>{deleting=index;find('db-delete-confirm').hidden=false;find('db-delete-confirm').querySelector('span').textContent='ลบ '+values[0]+' · '+(values[2]||values[4])+' หรือไม่?';find('db-delete-no').focus();},'db-danger');
        edit.disabled ||= editing!==null;remove.disabled ||= editing!==null;td.append(edit,remove);
      }
    }
    data.forEach((values,index)=>{if(index===editing || values.join(' ').toLowerCase().includes(query)){row(values,index);count++;}});
    if(editing===-1)row(['','','','','','',''],-1);
    find('db-count').textContent=count.toLocaleString('th-TH')+' / '+data.length.toLocaleString('th-TH')+' รายการ';
    find('db-add').disabled=!ready||busy||editing!==null||!canEdit();
    find('db-search').disabled=editing!==null||busy;
    find('db-close').disabled=busy;
    if(!count&&editing!==-1){const td=tbody.insertRow().insertCell();td.colSpan=8;td.textContent='ไม่พบรายการ';}
  }
  function focusEditor(){const input=tbody.querySelector('[data-editing] input');input?.focus();input?.scrollIntoView({block:'nearest'});}
  async function persist(rows) {
    const normalized=CrodValidation.validate(rows);
    const controls=Array.from(dialog.querySelectorAll('button,input'),el=>[el,el.disabled]);
    busy=true;controls.forEach(([el])=>el.disabled=true);
    try {
      let state={rows:normalized,revision:revision+1};
      if(window.crodDatabaseRequest)state=await window.crodDatabaseRequest('PUT',{rows:normalized,revision});
      else {
        const previous=JSON.parse(localStorage.getItem(storageKey)||'null');
        if((previous?.revision??0)!==revision)throw Error('ข้อมูลถูกแก้ไขจากอีกแท็บ กรุณาปิดแล้วเปิดตารางใหม่');
        localStorage.setItem(storageKey,JSON.stringify(state));
      }
      revision=state.revision;changed(state.rows);editing=null;deleting=null;find('db-delete-confirm').hidden=true;
      message('บันทึกแล้ว · กลุ่มผลรวมอัปเดตตามข้อมูลล่าสุด');
    } finally {busy=false;controls.forEach(([el,disabled])=>el.disabled=disabled);}
  }
  async function saveRow(tr,index) {
    const rows=structuredClone(window.CrodDatabase),values=Array.from(tr.querySelectorAll('input'),input=>input.value);
    if(index===-1)rows.push(values);else rows[index]=values;
    try{await persist(rows);render();}catch(error){message(error.message||'บันทึกไม่สำเร็จ',true);}
  }
  find('db-delete-yes').onclick=async()=>{
    if(deleting===null||busy)return;
    const rows=window.CrodDatabase.filter((_,index)=>index!==deleting);
    try{await persist(rows);render();}catch(error){message(error.message||'ลบไม่สำเร็จ',true);}
  };
  find('db-delete-no').onclick=()=>{deleting=null;find('db-delete-confirm').hidden=true;};
  find('db-add').onclick=()=>{editing=-1;deleting=null;find('db-delete-confirm').hidden=true;render();focusEditor();};
  find('db-search').oninput=render;
  function close(){if(busy)return;if(editing!==null&&!confirm('ปิดโดยไม่บันทึกการแก้ไขหรือไม่?'))return;dialog.close();}
  find('db-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  find('db-export').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({rows:window.CrodDatabase},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='crod-database.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.querySelector('#open-crod-database').onclick=async()=>{editing=null;deleting=null;ready=false;find('db-delete-confirm').hidden=true;dialog.showModal();message('กำลังอ่านฐานข้อมูล…');render();await load();};
  window.CrodDatabaseReady=load();
})();
