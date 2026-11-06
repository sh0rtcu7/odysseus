import {groupBrowserActivity} from './browserActivity.js';
import {showBrowser,hideBrowser,expandBrowser,restoreSplit} from './browserWorkspace.js';
// One UI for live and saved browser previews. Images stay out of model history.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states = new Map();
const requests = new Map();
const queues = new Map();
const activeViewers = new Map();
const viewers = new Map();
const dismissed = new Set();
const epochs = new Map();
const disconnected = new Set();
function dropInput(sid) {
  epochs.set(sid,(epochs.get(sid)||0)+1);
  for(const root of roots(sid)){clearTimeout(root._browserClickTimer);clearTimeout(root._browserTextTimer);root._browserPendingText='';if(root._browserClickIntent){root._browserClickIntent.cancelled=true;root._browserClickIntent.resolve();root._browserClickIntent=null;}}
}
let lastInputAt = 0;
let networkAvailable = true;
function newClientId() {
  // randomUUID is unavailable on plain HTTP LAN origins. getRandomValues
  // remains available there; keep client identity cryptographically random.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (byte, i) =>
    ([4, 6, 8, 10].includes(i) ? '-' : '') + byte.toString(16).padStart(2, '0')
  ).join('');
}
let client;
try {
  const reload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  client = reload && sessionStorage.getItem('browser-viewer-client') || newClientId();
  sessionStorage.setItem('browser-viewer-client', client);
} catch (_) { client = newClientId(); }
const sessionId = () => decodeURIComponent(location.hash.slice(1));
const leaseKey = sid => `browser-viewer-lease:${sid}`;
function lease(sid) { try { return sessionStorage.getItem(leaseKey(sid)) || ''; } catch (_) { return ''; } }
function remember(sid, token) { try { token ? sessionStorage.setItem(leaseKey(sid), token) : sessionStorage.removeItem(leaseKey(sid)); } catch (_) {} }

export function imagePoint(rect, width, height, x, y) {
  const scale = Math.min(rect.width / width, rect.height / height);
  const left = rect.left + (rect.width - width * scale) / 2;
  const top = rect.top + (rect.height - height * scale) / 2;
  const px = (x-left)/scale, py = (y-top)/scale;
  return scale > 0 && px >= 0 && py >= 0 && px < width && py < height ? {x:px,y:py} : null;
}

export function browserPreviewHtml(command='', screenshot='', url='', boundSessionId=null) {
  const sid = boundSessionId ?? sessionId();
  return `<div class="private-browser-preview browser-launcher" data-browser-session="${esc(sid)}">
    <button type="button" data-browser-open>Open browser</button>
    <span class="browser-launcher-status">Shared browser for this chat</span></div>`;
}
function viewerHtml(sid) {
  return `<div class="private-browser-preview browser-viewer" data-browser-session="${esc(sid)}" tabindex="0">
    <div class="private-browser-preview-header"><span class="private-browser-preview-title">Private Browser</span>
      <span class="private-browser-preview-status">Finished — connecting preview</span>
      <button type="button" data-browser-action="expand">Expand browser</button>
      <button type="button" data-browser-action="enlarge">Hide browser</button>
</div>
    <div class="browser-viewer-toolbar"><select aria-label="Browser tab" data-browser-tabs></select>
      <button type="button" data-browser-action="take">Take control</button>
      <button type="button" data-browser-action="release" hidden>Return control to Odysseus</button>
      <button type="button" data-browser-action="refresh">Refresh view</button>
      <div class="browser-viewer-zoom" role="group" aria-label="Page zoom">
        <button type="button" data-browser-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-browser-action="zoom-reset" title="Reset page zoom">100%</button>
        <button type="button" data-browser-action="zoom-in" aria-label="Zoom in">+</button></div></div>
    <div class="private-browser-preview-frame"><div class="private-browser-preview-empty">Preview unavailable until a browser session is open.</div>
      <img class="private-browser-preview-img" alt="Private browser page" hidden draggable="false"></div>
    <details class="browser-viewer-input" hidden><summary>Text input &amp; keys</summary><div class="browser-text-controls"><textarea autocomplete="off" spellcheck="false" aria-label="Text for focused browser field" placeholder="Click a field above, then type or paste here"></textarea>
      <button type="button" data-browser-action="text">Send text</button>
      <button type="button" data-browser-key="Enter">Enter</button><button type="button" data-browser-key="Tab">Tab</button>
      <button type="button" data-browser-key="Backspace">Backspace</button><button type="button" data-browser-key="Control+a">Select all</button>
      <select aria-label="Focused page dropdown" data-browser-options hidden></select></div></details>
    <div class="browser-viewer-message" role="status"></div></div>`;
}

async function api(sid, op='state', args={}) {
  if(!networkAvailable)throw new Error('Connection lost. Pending input was discarded.');
  const epoch=epochs.get(sid)||0;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),op==='take'?55000:15000);
  const response = await fetch(`/api/browser/${encodeURIComponent(sid)}/${op}`, op === 'state' ? {
    signal:controller.signal, credentials:'same-origin', headers:{'X-Browser-Client':client,'X-Browser-Lease':lease(sid)}, cache:'no-store'
  } : {signal:controller.signal,method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...args,client,lease:lease(sid)})}).finally(()=>clearTimeout(timer));
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || 'Browser view unavailable');
  if(epoch!==(epochs.get(sid)||0))throw new Error('Browser state changed. Refresh before continuing.');
  if (result.lease) remember(sid,result.lease);
  const previous=states.get(sid);
  if(previous && (previous.incarnation!==result.incarnation || previous.page!==result.page || (previous.controlling&&!result.controlling)))dropInput(sid);
  disconnected.delete(sid);
  states.set(sid,result);
  render(sid,result);
  return result;
}
function roots(sid) { return [...document.querySelectorAll('.browser-viewer')].filter(el => el.dataset.browserSession===sid); }
function render(sid,state) {
  for(const launcher of document.querySelectorAll('.browser-launcher')) {
    if(launcher.dataset.browserSession===sid)launcher.querySelector('.browser-launcher-status').textContent=
      state.controlling?'Browser paused — you have control':state.mode==='paused'?'Browser paused — reconnect to continue':'Shared browser for this chat';
  }
  for (const root of roots(sid)) {
    delete root.dataset.connection;
    const img=root.querySelector('img'), empty=root.querySelector('.private-browser-preview-empty');
    const labels={agent:state.busy ? 'Odysseus is working — previous view' : 'Ready — Odysseus controls the browser',requested:'Taking control — finishing current action',human:state.controlling ? 'You’re in control — Odysseus is paused' : 'Another viewer is in control',paused:'Paused — take control to reconnect or resume'};
    root.querySelector('.private-browser-preview-status').textContent=labels[state.mode] || 'Session closed';
    const tabs=root.querySelector('[data-browser-tabs]');
    tabs.replaceChildren(...(state.tabs||[]).map(tab => {const opt=document.createElement('option');opt.value=tab.page;opt.textContent=`${tab.page} · ${tab.url}`;return opt;}));
    tabs.value=state.page;
    const owns=!!state.controlling;
    root.querySelector('[data-browser-action="take"]').hidden=owns;
    root.querySelector('[data-browser-action="take"]').disabled=state.mode==='requested'||state.mode==='human';
    root.querySelector('[data-browser-action="release"]').hidden=!owns;
    root.querySelector('.browser-viewer-input').hidden=!owns;
    tabs.disabled=!owns;
    root.classList.toggle('user-controlled',owns);
    if (state.frame_id) {
      const src=`/api/browser/${encodeURIComponent(sid)}/frame/${encodeURIComponent(state.incarnation)}/${encodeURIComponent(state.frame_id)}`;
      if (img.getAttribute('src')!==src) { img.src=src; img.hidden=false; }
      empty.hidden=true;
    } else { empty.hidden=false; empty.textContent='Finished — no preview available'; }
    root.querySelector('.browser-viewer-message').textContent=owns ? 'Click a field, then type or paste directly. Return control when finished.' : 'This is the same private browser used by this chat.';
    const options=root.querySelector('[data-browser-options]');
    options.hidden=!state.options?.length;
    if (state.options?.length) options.replaceChildren(...state.options.map(o => {const el=document.createElement('option');el.value=o.value;el.textContent=o.label;el.selected=o.selected;return el;}));
  }
}
function error(sid, message) {
  disconnected.add(sid);dropInput(sid);
  const closed=/session closed|open a page first/i.test(message);
  if(closed){states.delete(sid);remember(sid,'');}
  for(const launcher of document.querySelectorAll('.browser-launcher'))if(launcher.dataset.browserSession===sid)launcher.querySelector('.browser-launcher-status').textContent=closed?'Browser session ended — open a new page':'Browser disconnected';
  for (const root of roots(sid)) {
    root.dataset.connection=closed?'closed':'disconnected';
    root.querySelector('.private-browser-preview-status').textContent=closed?'Browser session ended':'Disconnected — input disabled';
    if(closed){
      const img=root.querySelector('img');img.removeAttribute('src');img.hidden=true;delete img.dataset.loadedFrame;
      root.querySelector('[data-browser-action="take"]').disabled=true;
      root.querySelector('[data-browser-action="release"]').hidden=true;
      root.querySelector('.browser-viewer-input').hidden=true;
    }
    root.classList.remove('user-controlled');
    root.querySelector('.browser-viewer-message').textContent=message;
    const empty=root.querySelector('.private-browser-preview-empty');
    if (!root.querySelector('img')?.getAttribute('src')) {empty.hidden=false;empty.textContent=message;}
  }
}
async function refresh(sid) {
  if (!sid) return;
  if (requests.has(sid)) return requests.get(sid);
  const promise=api(sid).catch(e => error(sid,e.message)).finally(() => requests.delete(sid));
  requests.set(sid,promise);return promise;
}
function perform(root,op,args={}) {
  const sid=root.dataset.browserSession;
  activeViewers.set(sid,root);
  lastInputAt=Date.now();
  const epoch=epochs.get(sid)||0;
  const previous=queues.get(sid) || Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    // A frame refresh must finish before input, never silently discard a gesture.
    if(requests.has(sid)) await requests.get(sid);
    if(epoch!==(epochs.get(sid)||0) || (op==='input'&&(disconnected.has(sid)||root.hidden||sid!==sessionId())))return;
    return execute(root,op,args);
  });
  queues.set(sid,next);
  next.finally(()=>{if(queues.get(sid)===next)queues.delete(sid);});
  return next;
}
async function waitForImage(root,frameId) {
  const img=root.querySelector('img');
  if(img.dataset.loadedFrame===frameId)return;
  await new Promise((resolve,reject)=>{
    const done=()=>{cleanup();img.dataset.loadedFrame===frameId?resolve():reject(new Error('The page image changed. Try again.'));};
    const fail=()=>{cleanup();reject(new Error('Page image unavailable. Refresh the view.'));};
    const cleanup=()=>{clearTimeout(timer);img.removeEventListener('load',done);img.removeEventListener('error',fail);};
    const timer=setTimeout(fail,5000);
    img.addEventListener('load',done);img.addEventListener('error',fail);
  });
}
async function execute(root,op,args={}) {
  const sid=root.dataset.browserSession;
  const promise=(async () => {
    try {
      const inputEpoch=epochs.get(sid)||0;
      if(args.click_intent){await args.click_intent.ready;if(args.click_intent.cancelled || inputEpoch!==(epochs.get(sid)||0))return;}
      const state=states.get(sid);
      if(op==='input') {
        if(!state?.controlling)return;
        const epoch=epochs.get(sid)||0;
        await waitForImage(root,state.frame_id);
        if(epoch!==(epochs.get(sid)||0)||root.hidden||disconnected.has(sid))return;
      }
      if(op==='input' && (args.display_frame && args.display_frame !== state?.frame_id)) {
        dropInput(sid);root.querySelector('.browser-viewer-message').textContent='The page changed before that click. Please click again, then re-enter your text.';return;
      }
      const {display_frame,click_intent,...payload}=args;
      if(click_intent)payload.kind=click_intent.kind;
      const result=await api(sid,op,{...payload,...(['take','refresh'].includes(op)?{viewport:viewerViewport(root)}:{}),page:args.page||state?.page||root.querySelector('[data-browser-tabs]').value,
        frame_id:state?.frame_id,incarnation:state?.incarnation,width:state?.width,height:state?.height});
      if(op==='release') remember(sid,'');
      if(op==='take') root.focus({preventScroll:true});
      return result;
    } catch(e) {await api(sid).catch(()=>{});error(sid,e.message);}
    finally {requests.delete(sid);}
  })();
  requests.set(sid,promise);return promise;
}
function ensureViewer(sid) {
  if(viewers.has(sid))return viewers.get(sid);
  const template=document.createElement('template');template.innerHTML=viewerHtml(sid);
  const root=template.content.firstElementChild;root.hidden=true;
  viewers.set(sid,root);document.body.appendChild(root);
  return root;
}
function openViewer(sid,opener=null) {
  const root=ensureViewer(sid);
  for(const other of viewers.values())if(other!==root && !other.hidden)setExpanded(other,false);
  if(opener)root._browserOpener=opener;
  if(root.hidden)setExpanded(root,true,!!opener);
  hydrate();refresh(sid);
  return root;
}
function hydrate() {
  groupBrowserActivity();
  for(const root of document.querySelectorAll('.browser-viewer:not([data-viewer-mounted])')) {
    root.dataset.viewerMounted='1';
    const sid=root.dataset.browserSession;
    if(states.has(sid)) render(sid,states.get(sid));
    refresh(sid);
    root._browserResizeObserver=new ResizeObserver(()=>scheduleResize(root));
    root._browserResizeObserver.observe(root.querySelector('.private-browser-preview-frame'));
    const img=root.querySelector('img');
    img.addEventListener('load',()=>{const state=states.get(sid);if(state && img.getAttribute('src')?.endsWith('/'+encodeURIComponent(state.frame_id)))img.dataset.loadedFrame=state.frame_id;});
    if(img.complete && img.naturalWidth && states.get(sid)?.frame_id) img.dataset.loadedFrame=states.get(sid).frame_id;
    img.addEventListener('error',()=>{error(sid,'Preview changed or expired. Refresh view to reconnect.');});
  }
}
export function observeBrowserPreview(preview) {
  if(!preview?.session_id)return;
  const sid=preview.session_id;
  if(sid===sessionId() && !dismissed.has(sid))openViewer(sid);
  else if(viewers.has(sid))refresh(sid);
}
function viewerViewport(root) {
  const box=root.querySelector('.private-browser-preview-frame').getBoundingClientRect();
  const zoom=Number(root.dataset.zoom || 100)/100;
  return {width:Math.max(320,Math.min(1920,Math.round(box.width/zoom))),
    height:Math.max(240,Math.min(1600,Math.round(box.height/zoom)))};
}
function activeViewer(sid) {
  const all=roots(sid).filter(el=>!el.classList.contains('folded')&&el.getBoundingClientRect().width>0);
  return all.find(el=>el.classList.contains('browser-viewer-large')) || (all.includes(activeViewers.get(sid))?activeViewers.get(sid):all[0]);
}
function scheduleResize(root) {
  clearTimeout(root._browserResizeTimer);
  root._browserResizeTimer=setTimeout(()=>{
    const sid=root.dataset.browserSession,state=states.get(sid);
    if(!root.isConnected||root.hidden||disconnected.has(sid)||!state?.controlling||activeViewer(sid)!==root)return;
    if(requests.has(sid)||queues.has(sid)){scheduleResize(root);return;}
    const size=viewerViewport(root);
    if(size.width!==state.width || size.height!==state.height)perform(root,'refresh');
  },200);
}
function setExpanded(root,expanded,focus=false) {
  activeViewers.set(root.dataset.browserSession,root);
  if(expanded)showBrowser(root,{focus});else {
    const hadFocus=root.contains(document.activeElement);
    dismissed.add(root.dataset.browserSession);dropInput(root.dataset.browserSession);
    hideBrowser(root);
    if(hadFocus&&root._browserOpener?.isConnected)root._browserOpener.focus({preventScroll:true});
  }
  root.setAttribute('aria-label','Private browser');scheduleResize(root);
}
function flushText(root) {
  clearTimeout(root._browserTextTimer);
  const text=root._browserPendingText;
  root._browserPendingText='';
  if(text)return perform(root,'input',{kind:'text',text});
}
function init() {
  new MutationObserver(hydrate).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('odysseus:session-changed',event=>{
    for(const [sid,root] of viewers)if(sid!==event.detail?.sessionId && !root.hidden)setExpanded(root,false);
  });
  window.addEventListener('offline',()=>{networkAvailable=false;for(const sid of viewers.keys())error(sid,'Connection lost. Reconnect to fetch current browser state; pending input was discarded.');});
  window.addEventListener('online',()=>{networkAvailable=true;for(const sid of viewers.keys())if(sid===sessionId())refresh(sid);});
  window.addEventListener('hashchange',()=>{
    for(const [sid,root] of viewers)if(sid!==sessionId() && !root.hidden)setExpanded(root,false);
  });
  document.addEventListener('click',async event=>{
    const launcher=event.target.closest('[data-browser-open]');
    if(launcher){event.preventDefault();event.stopImmediatePropagation();openViewer(launcher.closest('[data-browser-session]').dataset.browserSession,launcher);return;}
    const root=event.target.closest('.browser-viewer');if(!root)return;
    const action=event.target.closest('[data-browser-action]')?.dataset.browserAction;
    const key=event.target.closest('[data-browser-key]')?.dataset.browserKey;
    event.stopImmediatePropagation();
    if(action||key||event.target.closest('.private-browser-preview-frame'))event.preventDefault();
    if(event.target.closest('.private-browser-preview-fold')) {event.preventDefault();setExpanded(root,false);return;}
    if(action==='enlarge'){setExpanded(root,false);return;}
    if(action==='expand'){expandBrowser(root);scheduleResize(root);return;}
    flushText(root);
    if(action?.startsWith('zoom-')) {
      activeViewers.set(root.dataset.browserSession,root);
      const zoom=Number(root.dataset.zoom||100);
      root.dataset.zoom=String(action==='zoom-reset'?100:Math.max(50,Math.min(200,zoom+(action==='zoom-in'?25:-25))));
      root.querySelector('[data-browser-action="zoom-reset"]').textContent=root.dataset.zoom+'%';
      if(!states.get(root.dataset.browserSession)?.controlling) {
        root.querySelector('.browser-viewer-message').textContent='Take control to resize the page and use zoom.';
      } else scheduleResize(root);
      return;
    }
    if(action==='text') {const input=root.querySelector('textarea');const text=input.value;if(text && await perform(root,'input',{kind:'text',text})) input.value='';return;}
    if(key){await perform(root,'input',{kind:'key',key});return;}
    if(action==='refresh') {const state=states.get(root.dataset.browserSession);await (state?.controlling?perform(root,'refresh'):refresh(root.dataset.browserSession));return;}
    if(action){await perform(root,action);return;}
    const state=states.get(root.dataset.browserSession);
    if(event.target.matches('img')&&state?.controlling&&!disconnected.has(root.dataset.browserSession)){
      const point=imagePoint(event.target.getBoundingClientRect(),state.width,state.height,event.clientX,event.clientY);
      if(!point)return;
      root.focus({preventScroll:true});
      if(event.detail===2 && root._browserClickIntent) {
        root._browserClickIntent.kind='double_click';clearTimeout(root._browserClickTimer);root._browserClickIntent.resolve();return;
      }
      const intent={kind:'click'};
      intent.ready=new Promise(resolve=>{intent.resolve=resolve;root._browserClickTimer=setTimeout(resolve,250);});
      root._browserClickIntent=intent;
      // Reserve queue order immediately: fast typing must follow the click.
      perform(root,'input',{kind:'click',...point,display_frame:state.frame_id,click_intent:intent})
        .finally(()=>{if(root._browserClickIntent===intent)root._browserClickIntent=null;});
    }
  },true);
  document.addEventListener('wheel',event=>{
    const root=event.target.closest('.browser-viewer');if(!root||!event.target.matches('img')||!states.get(root.dataset.browserSession)?.controlling)return;
    event.preventDefault();event.stopImmediatePropagation();
    perform(root,'input',{kind:'scroll',dx:Math.max(-2000,Math.min(2000,event.deltaX)),dy:Math.max(-2000,Math.min(2000,event.deltaY))});
  },{capture:true,passive:false});
  document.addEventListener('keydown',event=>{
    const root=event.target.closest('.browser-viewer');if(!root)return;
    // Keep viewer keystrokes out of the surrounding chat's shortcuts.
    event.stopImmediatePropagation();
    if(event.key==='Escape' && event.target!==root) {event.preventDefault();if(!restoreSplit(root))setExpanded(root,false);scheduleResize(root);return;}
    if(event.target!==root || !states.get(root.dataset.browserSession)?.controlling)return;
    const keys=['Enter','Tab','Escape','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'];
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v')return; // browser paste event
    if(event.key.length===1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
      event.preventDefault();lastInputAt=Date.now();
      root._browserPendingText=(root._browserPendingText||'')+event.key;
      clearTimeout(root._browserTextTimer);root._browserTextTimer=setTimeout(()=>flushText(root),80);return;
    }
    const selectAll=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a';
    if(keys.includes(event.key)||selectAll){event.preventDefault();flushText(root);perform(root,'input',{kind:'key',key:selectAll?'Control+a':event.shiftKey&&event.key==='Tab'?'Shift+Tab':event.key});}
  },true);
  document.addEventListener('paste',event=>{
    const root=event.target.closest('.browser-viewer');if(!root)return;
    event.stopImmediatePropagation();
    if(event.target!==root||!states.get(root.dataset.browserSession)?.controlling)return;
    event.preventDefault();flushText(root);
    const text=event.clipboardData?.getData('text/plain');if(text)perform(root,'input',{kind:'text',text});
  },true);
  document.addEventListener('change',event=>{
    const root=event.target.closest('.browser-viewer');if(!root)return;
    if(event.target.matches('[data-browser-tabs]')) perform(root,'refresh',{page:event.target.value});
    if(event.target.matches('[data-browser-options]')) perform(root,'input',{kind:'select',value:event.target.value});
  });
  setInterval(()=>{for(const [sid,state] of states) {
    const root=roots(sid)[0];if(!root || sid!==sessionId() || document.visibilityState!=='visible' || requests.has(sid) || queues.has(sid))continue;
    const interacting=Date.now()-lastInputAt<1500 || roots(sid).some(el=>el._browserPendingText);
    if(state.controlling && !interacting && !root.hidden) perform(root,'refresh'); else refresh(sid);
  }},2000);
  const main=document.getElementById('chat-container');
  if(main)new MutationObserver(()=>{if(main.classList.contains('compare-active'))for(const root of viewers.values())if(!root.hidden)setExpanded(root,false);}).observe(main,{attributes:true,attributeFilter:['class']});
  hydrate();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
