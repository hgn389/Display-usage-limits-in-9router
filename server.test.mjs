import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('proxy injects only HTML and authenticates isolated date storage', async () => {
  const mock = http.createServer((req, res) => {
    if (req.url === '/api/auth/status') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ requireLogin: true, authenticated: req.headers.cookie === 'session=test' }));
    } else if (req.url === '/stream') { res.setHeader('content-type', 'text/event-stream'); res.end('data: test\n\n'); }
    else { res.setHeader('content-type', 'text/html'); res.end('<html><body>Dashboard</body></html>'); }
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const data = await mkdtemp(path.join(os.tmpdir(), 'codex-addon-'));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url), env: { ...process.env, PORT: '0', UPSTREAM: `http://127.0.0.1:${mock.address().port}`, DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [output] = await once(child.stdout, 'data');
    const port = JSON.parse(String(output).match(/listening on (.*); upstream/)[1]).port;
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(base)).text(), /script src="\/__codex_addon\/client.js"/);
    assert.equal(await (await fetch(`${base}/stream`)).text(), 'data: test\n\n');
    assert.equal((await fetch(`${base}/__codex_addon/expiry`)).status, 401);
    const headers = { cookie: 'session=test', 'content-type': 'application/json', 'x-codex-addon': '1', origin: base };
    const put = (body, extra = {}) => fetch(`${base}/__codex_addon/expiry`, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await put({ id: 'c1', expiry: '2026-12-31' })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/__codex_addon/expiry`, { headers })).json(), { c1: '2026-12-31' });
    assert.equal((await put({ id: 'c1', expiry: '2026-02-30' })).status, 400);
    assert.equal((await put({ id: 'c1', expiry: '' }, { origin: 'http://attacker.test' })).status, 403);
    assert.equal((await put({ id: 'c1', expiry: '' })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/__codex_addon/expiry`, { headers })).json(), {});
  } finally {
    child.kill(); await once(child, 'exit'); mock.close(); await rm(data, { recursive: true, force: true });
  }
});
