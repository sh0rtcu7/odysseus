import os
import pytest

@pytest.mark.slow
async def test_browser_activity_groups_live_and_saved_nodes_without_losing_errors():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser=await pw.chromium.launch()
        page=await browser.new_page()
        await page.goto(os.environ['ODYSSEUS_TEST_STATIC_ORIGIN']+'/static/test-fixtures/browser-catalog.html')
        await page.evaluate('''async () => {
            const {groupBrowserActivity,setBrowserAction}=await import('/static/js/browserActivity.js');window.groupActivity=groupBrowserActivity;
            const thread=document.createElement('div');thread.className='agent-thread';document.body.append(thread);
            window.addBrowser=(name,extra='')=>{
                const node=document.createElement('div');node.className='agent-thread-node browser-preview-node '+extra;setBrowserAction(node,JSON.stringify({action:name}));
                node.innerHTML=`<div class="agent-thread-header">${name}</div><div class="browser-launcher" data-browser-session="chat"><button>Open browser</button></div><pre>${name} details</pre>`;
                thread.append(node);return node;
            };
            window.firstAction=addBrowser('open');window.currentAction=addBrowser('snapshot','running');
            groupBrowserActivity();
        }''')
        assert await page.locator('.browser-activity').count()==1
        assert await page.get_by_role('button',name='Open browser').count()==1
        assert await page.get_by_text('Browser activity · 2 actions · Opened page → Inspect page (working)',exact=True).count()==1
        await page.get_by_text('Browser activity · 2 actions · Opened page → Inspect page (working)',exact=True).click()
        assert await page.get_by_text('snapshot details',exact=True).is_visible()
        await page.evaluate('''() => {
            currentAction.classList.remove('running');currentAction.classList.add('error');
            currentAction.insertAdjacentHTML('beforeend','<div class="browser-launcher" data-browser-session="chat"><button>Open browser</button></div>');
            groupActivity();
        }''')
        assert await page.get_by_role('button',name='Open browser').count()==1
        assert await page.get_by_text('Browser activity · 2 actions · Opened page → Inspect page failed · 1 failed',exact=True).count()==1
        assert await page.locator('.browser-activity > details').get_attribute('open') is not None
        assert await page.evaluate('firstAction.isConnected && currentAction.isConnected')
        await page.evaluate('''() => {
            const other=document.createElement('div');other.textContent='Unrelated tool';document.querySelector('.agent-thread').append(other);
            addBrowser('click');groupActivity();groupActivity();
        }''')
        assert await page.locator('.browser-activity').count()==2
        assert await page.get_by_role('button',name='Open browser').count()==2
        assert await page.locator('.browser-preview-node').count()==3
        await browser.close()
