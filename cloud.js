'use strict';
let admin=false,auth=null;const cfg=window.SUPABASE_CONFIG;
async function request(path,method='GET',body,raw=false){if(!cfg.url||!cfg.key)throw Error('请在 config.js 配置 Supabase 项目地址及公开密钥');const r=await fetch(cfg.url+path,{method,headers:{apikey:cfg.key,...(auth?{Authorization:'Bearer '+auth.access_token}:{}),...(body?{'Content-Type':raw?body.type:'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});if(!r.ok){const e=await r.json().catch(()=>({}));throw Object.assign(Error(e.message||e.error_description||'云端操作失败'),{code:e.code})}return r.status===204||r.headers.get('content-length')==='0'?null:r.json().catch(()=>null)}
let postingDeadline=0, postingEnd=null, postingLoaded=false, migrationMissing=false, expiryTimer, statusVersion=0;
function visitorPostingOpen(){return performance.now()<postingDeadline}
function canPost(){return admin||visitorPostingOpen()}
function canMessage(){return canPost()||(migrationMissing&&!!auth)}
function postingPermissions(){
  const open=visitorPostingOpen(),allowed=canPost();
  document.querySelectorAll('.add-trigger').forEach(b=>b.hidden=!allowed);
  $('#message-form button').disabled=!canMessage()||messageBusy;
  $('#posting-status').textContent=open
    ? '访客投稿已开放，可上传照片和留言。截止：'+postingEnd.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）'
    : postingLoaded?'访客投稿已关闭。':'暂未获取访客投稿状态。';
  if(!allowed&&$('#photo-import').open)$('#photo-import').close();
}
function permissions(){ $('#edit-info').hidden=!admin;$('#posting-window').hidden=!admin;$('#login-form').hidden=!!auth;$('#logout').hidden=!auth;$('#auth-status').textContent=auth?(admin?'管理员已登录':'同学已登录'):'访客浏览';postingPermissions();render()}
async function loadPostingWindow(){
  const version=++statusVersion,start=performance.now();
  let row;
  try{[row]=await request('/rest/v1/rpc/visitor_window_status','POST',{})}
  catch(e){if(version===statusVersion&&e.code==='PGRST202'){migrationMissing=true;postingPermissions();return}throw e}
  if(version!==statusVersion)return;
  postingLoaded=true;migrationMissing=false;
  postingEnd=row?.closes_at?new Date(row.closes_at):null;
  postingDeadline=postingEnd?start+Math.max(0,postingEnd.getTime()-Date.parse(row.server_time)):0;
  clearTimeout(expiryTimer);
  if(visitorPostingOpen())expiryTimer=setTimeout(postingPermissions,Math.max(0,postingDeadline-performance.now())+5);
  postingPermissions();
}
async function setPostingWindow(minutes){
  if(!admin)return;
  const buttons=$('#posting-window').querySelectorAll('button');
  buttons.forEach(b=>b.disabled=true);
  try{
    await request('/rest/v1/rpc/set_visitor_window','POST',{minutes});
    await loadPostingWindow();
    toast(minutes?'访客投稿已开放':'访客投稿已关闭');
  }catch(e){toast(e.message)}finally{buttons.forEach(b=>b.disabled=false)}
}
$('#posting-window').onsubmit=e=>{e.preventDefault();setPostingWindow(Number(e.target.elements.minutes.value))};
$('#close-posting').onclick=()=>setPostingWindow(0);

async function recordVisit(){
  let visitor_id=null;
  try{
    const key='class-site-visitor-id';
    visitor_id=localStorage.getItem(key);
    if(!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(visitor_id||'')){
      visitor_id=crypto.randomUUID();
      localStorage.setItem(key,visitor_id);
    }
  }catch{visitor_id=null}
  const [counts]=await request('/rest/v1/rpc/record_site_visit','POST',{visitor_id});
  if(counts){
    $('#visitors-total').textContent=Number(counts.total).toLocaleString('zh-CN');
    $('#visitors-today').textContent=Number(counts.today).toLocaleString('zh-CN');
  }
}
async function messages(){const rows=await request('/rest/v1/messages?select=*&order=created_at.desc&limit=100');$('#message-list').replaceChildren();rows.forEach(r=>{const c=el('article','message-card');c.append(el('strong','',r.nickname),el('span','',new Date(r.created_at).toLocaleString('zh-CN')),el('p','',r.content));$('#message-list').append(c)})}
async function album(){const rows=await request('/rest/v1/photos?select=*&order=created_at.desc');photos.splice(0,photos.length,...rows.map(r=>({...r,src:cfg.url+'/storage/v1/object/public/class-photos/'+r.storage_path})));render()}
const previewInfo=form.onsubmit;
function displayInfo(data){for(const [k,v] of Object.entries(data))if(form.elements[k])form.elements[k].value=v;previewInfo({preventDefault(){}})}
form.onsubmit=async e=>{e.preventDefault();if(!admin)return;const b=form.querySelector('[type=submit]');b.disabled=true;try{const data=Object.fromEntries(new FormData(form));await request('/rest/v1/class_info?id=eq.1','PATCH',{data});displayInfo(data);toast('班级资料已保存')}catch(e){toast(e.message)}finally{b.disabled=false}};
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const d=new FormData(e.target);auth=await request('/auth/v1/token?grant_type=password','POST',{email:d.get('email'),password:d.get('password')});e.target.reset();admin=(await request('/rest/v1/admins?select=user_id')).some(r=>r.user_id===auth.user.id);permissions();toast('登录成功')}catch(e){auth=null;admin=false;permissions();toast(e.message)}finally{b.disabled=false}};
$('#logout').onclick=async()=>{try{await request('/auth/v1/logout','POST')}catch{}auth=null;admin=false;permissions()};
let messageBusy=false;
$('#message-form').onsubmit=async e=>{e.preventDefault();if(!canMessage())return toast('访客投稿暂未开放');if(messageBusy)return;messageBusy=true;postingPermissions();try{const d=new FormData(e.target),nickname=d.get('nickname').trim(),content=d.get('message').trim();if(!nickname||!content)throw Error('请填写昵称和内容');await request('/rest/v1/messages','POST',{nickname,content,...(auth?{user_id:auth.user.id}:{})});e.target.reset();await messages();toast('留言已保存')}catch(e){toast(e.message)}finally{messageBusy=false;postingPermissions()}};
$('#file-input').onchange=async e=>{if(!canPost()||uploadBusy){e.target.value='';return;}uploadBusy=true;const category=uploadCategory;try{for(const f of e.target.files){if(!canPost())throw Error('访客投稿时段已结束');if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(f.type)||f.size>20*1024*1024)throw Error('请选择20 MB以内的图片');const storage_path=crypto.randomUUID();toast('正在上传 '+f.name);await request('/storage/v1/object/class-photos/'+storage_path,'POST',f,true);try{await request('/rest/v1/photos','POST',{storage_path,title:f.name.replace(/\.[^.]+$/,''),category})}catch(e){if(admin)await request('/storage/v1/object/class-photos','DELETE',{prefixes:[storage_path]}).catch(()=>{});throw e}}toast('上传完成')}catch(e){toast(e.message)}finally{uploadBusy=false;e.target.value='';await album().catch(e=>toast(e.message))}};
const baseRender=render;render=function(){baseRender();gallery.querySelectorAll('.tag').forEach(e=>e.textContent='班级照片');gallery.querySelectorAll('.photo-meta p').forEach((e,i)=>e.textContent=labels[visible[i].category]);$('.image-note').textContent='班级云端相册';if(admin)gallery.querySelectorAll('.photo-card').forEach((card,i)=>{const p=visible[i],b=el('button','','删除照片');b.onclick=async()=>{b.disabled=true;try{await request('/rest/v1/photos?id=eq.'+p.id,'DELETE');await request('/storage/v1/object/class-photos','DELETE',{prefixes:[p.storage_path]});await album()}catch(e){toast(e.message);b.disabled=false}};card.append(b)})};
permissions();Promise.all([album(),messages(),request('/rest/v1/class_info?id=eq.1&select=data').then(rows=>{if(rows[0])displayInfo(rows[0].data)})]).then(()=>toast('云端数据已加载')).catch(e=>toast(e.message));

loadPostingWindow().catch(()=>{});
setInterval(()=>{if(!document.hidden)loadPostingWindow().catch(()=>{})},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPostingWindow().catch(()=>{})});
recordVisit().catch(()=>{});
