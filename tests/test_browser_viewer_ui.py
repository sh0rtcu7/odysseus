"""Actual viewer module in Chromium: scaled input, safe leases and handoff UI."""
import io
import asyncio
import os
import json
import pytest
from PIL import Image

@pytest.mark.slow
async def test_viewer_take_control_scaled_click_text_and_release():
    from playwright.async_api import async_playwright
    origin=os.environ['ODYSSEUS_TEST_STATIC_ORIGIN']
    pixels=io.BytesIO();Image.new('RGB',(1280,900),'white').save(pixels,format='JPEG')
    state=dict(session_id='viewer-chat',incarnation='instance',page='t1',frame_id='frame0',width=1280,height=900,
               revision=0,mode='agent',controlling=False,tabs=[{'page':'t1','url':'https://catalog.example/'}])
    actions=[]
    expired=False
    async def route(request):
        if expired:
            await request.fulfill(status=409,content_type='application/json',body=json.dumps({'detail':'Browser session closed. Ask Odysseus to open a page first.'}));return
        if '/frame/' in request.request.url:
            frame=io.BytesIO();Image.new('RGB',(state['width'],state['height']),'white').save(frame,format='JPEG')
            await request.fulfill(status=200,content_type='image/jpeg',body=frame.getvalue());return
        if request.request.method=='POST':
            args=request.request.post_data_json;operation=request.request.url.rsplit('/',1)[-1]
            actions.append((operation,args))
            if operation=='input': await asyncio.sleep(.08)
            if args.get('viewport'):state.update(args['viewport'])
            if operation=='take':state.update(mode='human',controlling=True,lease='secret-lease')
            elif operation=='release':state.update(mode='agent',controlling=False);state.pop('lease',None)
            else:state['frame_id']='frame'+str(len(actions))
        await request.fulfill(status=200,content_type='application/json',body=json.dumps(state))
    async with async_playwright() as pw:
        browser=await pw.chromium.launch()
        page=await browser.new_page()
        await page.route('**/api/browser/**',route)
        await page.goto(origin+'/static/test-fixtures/browser-catalog.html')
        await page.set_content('<main id="chat-container" style="height:calc(100vh - 20px);display:flex"><div id="viewer" style="flex:1;overflow:auto"></div><textarea id="message" aria-label="Message input">Unsent draft</textarea></main>')
        await page.add_style_tag(url=origin+'/static/css/03-agent-chat.css')
        await page.evaluate("""async () => {
            location.hash='viewer-chat';
            const mod=await import('/static/js/browserViewer.js');window.viewerModule=mod;
            document.querySelector('#viewer').innerHTML=mod.browserPreviewHtml()+mod.browserPreviewHtml();
        }""")
        await page.get_by_role('button',name='Open browser',exact=True).first.click()
        assert await page.locator('.browser-viewer').count()==1
        assert await page.locator('#viewer img').count()==0
        await page.get_by_text('Ready — Odysseus controls the browser',exact=True).wait_for()
        await page.get_by_role('button',name='Take control',exact=True).click()
        await page.get_by_text('You’re in control — Odysseus is paused',exact=True).wait_for()
        await page.wait_for_function('''() => {
            const img=document.querySelector('.browser-viewer img'),box=document.querySelector('.private-browser-preview-frame').getBoundingClientRect();
            return img.naturalWidth===Math.round(box.width) && img.naturalHeight===Math.round(box.height)
                && img.dataset.loadedFrame===img.src.split('/').pop();
        }''')
        img=page.locator('.browser-viewer img')
        box=await img.bounding_box()
        assert box['width'] < 1280
        await img.click(position={'x':box['width']/2,'y':box['height']/2})
        for _ in range(100):
            if any(a[1].get('kind')=='click' for a in actions):break
            await asyncio.sleep(.02)
        click=next(args for op,args in actions if args.get('kind')=='click')
        assert click['kind']=='click' and abs(click['x']-click['width']/2)<3 and abs(click['y']-click['height']/2)<3
        await page.get_by_text('Text input & keys',exact=True).click()
        await page.get_by_role('textbox',name='Text for focused browser field').fill('test input')
        await page.get_by_role('button',name='Send text',exact=True).click()
        await page.wait_for_function("document.querySelector('.browser-viewer textarea').value === ''")
        assert actions[-1][1]['text']=='test input'
        # Direct typing and ordered keys work even while the prior request is pending.
        root=page.locator('.browser-viewer')
        await root.focus()
        await page.keyboard.type('direct typing')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Tab')
        await page.wait_for_function("document.querySelector('.browser-viewer img').dataset.loadedFrame === document.querySelector('.browser-viewer img').src.split('/').pop()")
        for _ in range(100):
            if any(a[1].get('key')=='Tab' for a in actions):break
            await asyncio.sleep(.02)
        inputs=[args for op,args in actions if op=='input']
        assert [args.get('text') or args.get('key') for args in inputs[-3:]]==['direct typing','Enter','Tab']
        await page.wait_for_function("document.querySelector('.browser-viewer img').dataset.loadedFrame === document.querySelector('.browser-viewer img').src.split('/').pop()")
        await page.wait_for_function("frame => document.querySelector('.browser-viewer img').dataset.loadedFrame === frame", arg='frame'+str(len(actions)))
        fast_box=await img.bounding_box()
        await img.click(position={'x':fast_box['width']/2,'y':fast_box['height']/2})
        await page.keyboard.type('fast typing')
        await page.keyboard.press('Enter')
        for _ in range(100):
            latest=[args for op,args in actions if op=='input']
            if len(latest)>=8 and latest[-1].get('key')=='Enter':break
            await asyncio.sleep(.02)
        assert [args['kind'] for args in latest[-3:]]==['click','text','key']
        assert latest[-2]['text']=='fast typing'
        # Loss of connectivity invalidates input until authoritative state returns.
        await page.evaluate("window.dispatchEvent(new Event('offline'))")
        await page.get_by_text('Disconnected — input disabled',exact=True).wait_for()
        before=len([a for a in actions if a[0]=='input'])
        await root.focus();await page.keyboard.type('discard me');await page.keyboard.press('Enter')
        await asyncio.sleep(.15)
        assert len([a for a in actions if a[0]=='input'])==before
        await page.evaluate("window.dispatchEvent(new Event('online'))")
        await page.get_by_text('You’re in control — Odysseus is paused',exact=True).wait_for()
        # The workspace preserves the chat DOM and a single browser pane.
        await page.get_by_role('button',name='Hide browser',exact=True).click()
        assert not await root.is_visible()
        await page.get_by_role('button',name='Open browser',exact=True).last.click()
        assert await page.locator('.browser-viewer').count()==1
        assert await root.is_visible()
        assert await root.evaluate("el => el.parentElement.id === 'browser-pane'")
        await page.get_by_role('button',name='Expand browser',exact=True).click()
        box=await root.bounding_box()
        assert box['width'] > 1000 and box['height'] > 600
        for _ in range(100):
            if state['width']>1000:break
            await asyncio.sleep(.02)
        assert state['width']>1000
        normal_width=state['width']
        await page.get_by_role('button',name='Zoom in',exact=True).click()
        for _ in range(100):
            if state['width']<normal_width:break
            await asyncio.sleep(.02)
        assert abs(state['width']-normal_width/1.25)<3
        await page.get_by_role('button',name='125%',exact=True).click()
        await page.screenshot(path='/private/tmp/odysseus-browser-viewer-expanded.png')
        await page.keyboard.press('Escape')
        assert await root.is_visible()
        assert not await page.locator('#browser-workspace').evaluate("el => el.classList.contains('browser-expanded')")
        assert await page.get_by_role('textbox',name='Message input',exact=True).input_value()=='Unsent draft'
        await page.get_by_role('button',name='Hide browser',exact=True).click()
        assert not await root.is_visible()
        assert not await root.get_attribute('aria-modal')
        assert 'secret-lease' not in await page.content()
        assert not await page.locator('.private-browser-preview-spinner').count()
        await page.get_by_role('button',name='Open browser',exact=True).first.click()
        await page.get_by_role('button',name='Return control to Odysseus',exact=True).click()
        await page.get_by_text('Ready — Odysseus controls the browser',exact=True).wait_for()
        assert actions[-1][0]=='release'
        divider=page.get_by_role('separator',name='Resize chat and browser')
        await divider.focus()
        old=await divider.get_attribute('aria-valuenow')
        await page.keyboard.press('ArrowRight')
        assert int(await divider.get_attribute('aria-valuenow'))>int(old)
        await page.set_viewport_size({'width':600,'height':700})
        await page.wait_for_function("document.querySelector('#browser-workspace').classList.contains('browser-stacked')")
        assert await page.locator('.browser-divider').get_attribute('aria-orientation')=='horizontal'
        assert not await divider.is_visible()
        assert await page.get_by_role('textbox',name='Message input',exact=True).is_visible()
        await page.get_by_role('button',name='Browser',exact=True).click()
        assert await root.is_visible()
        await page.set_viewport_size({'width':390,'height':640})
        await page.wait_for_function("document.querySelector('#browser-workspace').classList.contains('browser-compact')")
        assert await page.locator('body').evaluate('el => el.scrollWidth <= window.innerWidth')
        await page.get_by_role('button',name='Chat',exact=True).click()
        assert await page.get_by_role('textbox',name='Message input',exact=True).is_visible()
        await page.get_by_role('button',name='Browser',exact=True).click()
        assert await root.is_visible()
        await page.set_viewport_size({'width':844,'height':390})
        await page.wait_for_function("document.querySelector('#browser-workspace').classList.contains('browser-compact')")
        assert await page.get_by_role('button',name='Chat',exact=True).is_visible()
        await page.get_by_role('button',name='Chat',exact=True).click()
        assert await page.get_by_role('textbox',name='Message input',exact=True).is_visible()
        await page.get_by_role('button',name='Browser',exact=True).click()
        assert await root.is_visible()
        await page.set_viewport_size({'width':1280,'height':720})
        # A late tool event updates the same viewer and respects manual close.
        await page.get_by_role('button',name='Hide browser',exact=True).click()
        await page.evaluate("viewerModule.observeBrowserPreview({session_id:'viewer-chat'})")
        assert await page.locator('.browser-viewer').count()==1
        assert not await root.is_visible()
        await page.get_by_role('button',name='Open browser',exact=True).first.click()
        await page.evaluate("window.dispatchEvent(new CustomEvent('odysseus:session-changed',{detail:{sessionId:'another-chat'}}))")
        assert not await root.is_visible()
        points=await page.evaluate("""() => ({
            outside:viewerModule.imagePoint({left:0,top:0,width:1000,height:500},1280,900,0,250),
            center:viewerModule.imagePoint({left:0,top:0,width:1000,height:500},1280,900,500,250)
        })""")
        assert points['outside'] is None
        assert points['center']=={'x':640,'y':450}
        expired=True
        await page.get_by_role('button',name='Open browser',exact=True).first.click()
        await page.get_by_text('Browser session ended',exact=True).wait_for()
        assert await img.get_attribute('src') is None
        assert await page.get_by_role('button',name='Take control',exact=True).is_disabled()
        await browser.close()
