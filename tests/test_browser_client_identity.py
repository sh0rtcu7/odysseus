import asyncio
import pytest
from src.browser_client_identity import BrowserClientIdentityMiddleware, client_user_agent

async def invoke(header, handler):
    await BrowserClientIdentityMiddleware(handler)({'type':'http','headers':[(b'user-agent',header)]},None,None)

async def test_identity_is_request_scoped_and_propagates_to_child_tasks():
    async def handler(scope,receive,send):
        before=client_user_agent()
        async def child():
            await asyncio.sleep(0)
            assert client_user_agent()==before
        await asyncio.create_task(child())
        return before
    await asyncio.gather(invoke(b'Browser A',handler),invoke(b'Browser B',handler))
    assert client_user_agent() is None

@pytest.mark.parametrize('header',[b'',b'x'*1025,b'invalid\r\nheader',b'nonascii\xff'])
async def test_invalid_headers_use_default(header):
    async def handler(*args): assert client_user_agent() is None
    await invoke(header,handler)

async def test_identity_is_reset_after_error():
    async def handler(*args):
        assert client_user_agent()=='Browser A'
        raise ValueError('test')
    with pytest.raises(ValueError): await invoke(b'Browser A',handler)
    assert client_user_agent() is None
