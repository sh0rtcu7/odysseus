"""Browser viewer imports must not break the app on HTTP LAN origins."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.mark.parametrize('storage_blocked,reload', [(False, False), (True, False), (False, True)])
def test_viewer_import_without_secure_context_uuid(storage_blocked, reload):
    if not shutil.which('node'):
        pytest.skip('node is not installed')
    root = Path(__file__).resolve().parents[1]
    script = """
      import assert from 'node:assert/strict';
      import {webcrypto} from 'node:crypto';
      // HTTP LAN origins expose getRandomValues but not randomUUID.
      Object.defineProperty(globalThis, 'crypto', {value: {
        getRandomValues: bytes => webcrypto.getRandomValues(bytes)
      }, configurable: true});
      const values = new Map([['browser-viewer-client', 'existing-tab']]);
      globalThis.sessionStorage = {
        getItem: key => values.get(key),
        setItem: (key, value) => {
          if (STORAGE_BLOCKED) throw new Error('Storage blocked');
          values.set(key, value);
        }
      };
      globalThis.performance = {getEntriesByType: () => [{type: RELOAD ? 'reload' : 'navigate'}]};
      let startupBound = false;
      globalThis.document = {readyState: 'loading', addEventListener: name => {
        if (name === 'DOMContentLoaded') startupBound = true;
      }};
      const viewer = await import('./static/js/browserViewer.js');
      assert.equal(typeof viewer.browserPreviewHtml, 'function');
      assert.equal(startupBound, true);
      if (!STORAGE_BLOCKED) {
        const id = values.get('browser-viewer-client');
        if (RELOAD) assert.equal(id, 'existing-tab');
        else assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    """.replace('STORAGE_BLOCKED', json.dumps(storage_blocked)).replace('RELOAD', json.dumps(reload))
    result = subprocess.run(['node', '--input-type=module'], input=script,
                            capture_output=True, text=True, cwd=root, timeout=30)
    assert result.returncode == 0, result.stderr
