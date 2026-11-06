// Presentation only: never owns browser leases or remote actions.
let current=null, ratio=.5, observer;
try { const saved=Number(localStorage.getItem('browser-split-ratio')); if(saved>.1&&saved<.9)ratio=saved; } catch (_) {}
function shell() {
  let workspace=document.getElementById('browser-workspace');
  if(!workspace) {
    const main=document.getElementById('chat-container');if(!main)return null;
    workspace=document.createElement('div');workspace.id='browser-workspace';
    const chat=document.createElement('div');chat.id='browser-chat-column';
    while(main.firstChild)chat.appendChild(main.firstChild);
    workspace.appendChild(chat);main.appendChild(workspace);
  }
  if(!workspace.querySelector('.browser-divider')) {
    const divider=document.createElement('div');divider.className='browser-divider';divider.tabIndex=0;
    divider.setAttribute('role','separator');divider.setAttribute('aria-label','Resize chat and browser');
    const host=document.createElement('aside');host.id='browser-pane';host.setAttribute('aria-label','Browser pane');
    const mobile=document.createElement('div');mobile.className='browser-mobile-tabs';
    mobile.setAttribute('role','group');mobile.setAttribute('aria-label','Workspace view');
    mobile.innerHTML='<button type="button" data-workspace-tab="chat">Chat</button><button type="button" data-workspace-tab="browser">Browser</button>';
    workspace.prepend(mobile);workspace.append(divider,host);
    mobile.addEventListener('click',e=>{const tab=e.target.closest('[data-workspace-tab]');if(!tab)return;workspace.dataset.mobilePane=tab.dataset.workspaceTab;layout();});
    const layout=()=>{
      const b=workspace.getBoundingClientRect();const stacked=b.width<760||b.height<500;
      workspace.classList.toggle('browser-stacked',stacked);
      const compact=stacked&&(b.width<480||b.height<760);
      if(compact&&!workspace.classList.contains('browser-compact'))workspace.dataset.mobilePane='chat';
      workspace.classList.toggle('browser-compact',compact);
      for(const button of mobile.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.workspaceTab===(workspace.dataset.mobilePane||'chat')));
      const extent=stacked?b.height:b.width;const min=stacked?220:360;
      const low=Math.min(.5,min/Math.max(1,extent-8));const value=Math.max(low,Math.min(1-low,ratio));
      workspace.style.setProperty('--browser-chat-share',`${value*100}%`);
      divider.setAttribute('aria-orientation',stacked?'horizontal':'vertical');
      divider.setAttribute('aria-valuemin',String(Math.round(low*100)));divider.setAttribute('aria-valuemax',String(Math.round((1-low)*100)));
      divider.setAttribute('aria-valuenow',String(Math.round(value*100)));
    };
    let dragging=false;
    divider.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();dragging=true;divider.setPointerCapture(e.pointerId);workspace.classList.add('browser-dragging');});
    divider.addEventListener('pointermove',e=>{if(!dragging)return;const b=workspace.getBoundingClientRect();ratio=workspace.classList.contains('browser-stacked')?(e.clientY-b.top)/b.height:(e.clientX-b.left)/b.width;ratio=Math.max(.15,Math.min(.85,ratio));layout();});
    const end=()=>{ratio=Math.max(.15,Math.min(.85,ratio));dragging=false;workspace.classList.remove('browser-dragging');try{localStorage.setItem('browser-split-ratio',String(ratio));}catch(_){};};
    divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);divider.addEventListener('lostpointercapture',end);
    divider.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();ratio=e.key==='Home'?.15:e.key==='End'?.85:ratio+(['ArrowLeft','ArrowUp'].includes(e.key)?-.05:.05);layout();end();});
    divider.addEventListener('dblclick',()=>{ratio=.5;layout();end();});
    observer=new ResizeObserver(layout);observer.observe(workspace);layout();
  }
  return workspace;
}
export function showBrowser(root,{focus=false}={}) {
  const workspace=shell();if(!workspace)return;
  if(current&&current!==root)current.hidden=true;
  root.querySelector('[data-browser-action=expand]').textContent='Expand browser';
  current=root;workspace.querySelector('#browser-pane').appendChild(root);root.hidden=false;
  root.setAttribute('role','region');root.removeAttribute('aria-modal');
  workspace.classList.add('browser-open');workspace.classList.remove('browser-expanded');
  if(focus){workspace.dataset.mobilePane='browser';workspace.querySelector('[data-workspace-tab=browser]').setAttribute('aria-pressed','true');workspace.querySelector('[data-workspace-tab=chat]').setAttribute('aria-pressed','false');root.focus({preventScroll:true});}
}
export function hideBrowser(root) {
  root.hidden=true;
  if(root===current){const w=shell();w?.classList.remove('browser-open','browser-expanded','browser-dragging');current=null;}
}
export function expandBrowser(root) {
  const w=shell();if(!w||current!==root)return;
  const expanded=w.classList.toggle('browser-expanded');
  root.querySelector('[data-browser-action="expand"]').textContent=expanded?'Restore split view':'Expand browser';
}
export function restoreSplit(root) {
  const w=shell();if(!w?.classList.contains('browser-expanded'))return false;
  w.classList.remove('browser-expanded');root.querySelector('[data-browser-action="expand"]').textContent='Expand browser';return true;
}
