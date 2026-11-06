"""Request-scoped browser compatibility metadata, never an authority grant."""
from contextvars import ContextVar

_CLIENT_USER_AGENT = ContextVar('browser_client_user_agent', default=None)


def client_user_agent():
    return _CLIENT_USER_AGENT.get()


class BrowserClientIdentityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        raw = next((value for key,value in scope.get('headers',[]) if key.lower()==b'user-agent'), b'')
        # Reject oversized/control-containing values. Missing or invalid client
        # metadata leaves Chromium's normal default untouched.
        user_agent = raw.decode('latin-1') if raw and len(raw)<=1024 and all(32<=v<=126 for v in raw) else None
        token = _CLIENT_USER_AGENT.set(user_agent)
        try:
            await self.app(scope, receive, send)
        finally:
            _CLIENT_USER_AGENT.reset(token)
