const actions = {
  open:['Open page','Opened page'],navigate:['Navigate','Navigated'],new_page:['Open tab','Opened tab'],
  snapshot:['Inspect page','Inspected page'],read:['Read page','Read page'],find:['Find on page','Searched page'],
  click:['Click','Clicked'],double_click:['Double-click','Double-clicked'],fill:['Enter text','Entered text'],
  press:['Press key','Pressed key'],select:['Select option','Selected option'],hover:['Hover','Hovered'],
  scroll:['Scroll','Scrolled'],wait:['Wait','Waited'],screenshot:['Capture screenshot','Captured screenshot'],
  reload:['Reload page','Reloaded page'],back:['Go back','Went back'],forward:['Go forward','Went forward'],
  tabs:['List tabs','Listed tabs'],select_page:['Switch tab','Switched tab'],close_page:['Close tab','Closed tab'],
  close:['Close browser','Closed browser'],session_info:['Check browser','Checked browser']
};
export function setBrowserAction(node,command) {
  let action='';
  try {action=JSON.parse(command||'{}')?.action||'';}catch(_){action=String(command||'').trim().split(/\s+/)[0];}
  node.dataset.browserAction=Object.hasOwn(actions,action)?action:'';
}
function actionLabel(node) {
  const [name,done]=actions[node.dataset.browserAction]||['Browser action','Browser action'];
  return node.classList.contains('error')?`${name} failed`:node.classList.contains('running')?`${name} (working)`:done;
}
// Group presentation only. Preserve each node and its live execution identity.
export function groupBrowserActivity(scope=document) {
  for(const node of scope.querySelectorAll('.agent-thread > .browser-preview-node')) {
    const launcher=node.querySelector('.browser-launcher');
    if(!launcher)continue;
    const sid=launcher.dataset.browserSession;
    let group=node.previousElementSibling;
    if(!group?.classList.contains('browser-activity') || group.dataset.browserSession!==sid) {
      group=document.createElement('section');group.className='browser-activity';group.dataset.browserSession=sid;
      group.innerHTML='<details><summary>Browser activity</summary><div class="browser-activity-actions"></div></details>';
      node.before(group);group.prepend(launcher);
    }
    group.querySelector('.browser-activity-actions').appendChild(node);
  }
  for(const group of scope.querySelectorAll('.browser-activity')) {
    // Live result rewrites can insert another launcher into an existing node.
    for(const launcher of group.querySelectorAll('.browser-activity-actions .browser-launcher'))launcher.remove();
    const nodes=[...group.querySelectorAll('.browser-preview-node')];
    const failed=nodes.filter(node=>node.classList.contains('error')).length;
    const labels=nodes.map(node=>{
      const label=actionLabel(node),header=node.querySelector('.agent-thread-tool');
      if(header && header.textContent!==label)header.textContent=label;
      return label;
    });
    const preview=labels.slice(-3).join(' → ');
    const label=`Browser activity · ${nodes.length} ${nodes.length===1?'action':'actions'} · ${nodes.length>3?`+${nodes.length-3} earlier → `:''}${preview}${failed?` · ${failed} failed`:''}`;
    const summary=group.querySelector('summary');
    if(summary.textContent!==label)summary.textContent=label;
    group.classList.toggle('has-failure',failed>0);
  }
}
