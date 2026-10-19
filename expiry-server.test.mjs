import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('native expiry storage checks CORS and dashboard auth, persists concurrent writes and clears dates', async () => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ requireLogin: true, authenticated: req.headers.cookie === 'session=test' }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const data = await mkdtemp(path.join(os.tmpdir(), 'native-expiry-'));
  const origin = 'http://dashboard.test:9090';
  const child = spawn(process.execPath, ['expiry-server.mjs'], {
    cwd: new URL('.', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', UPSTREAM: `http://127.0.0.1:${upstream.address().port}`, DASHBOARD_ORIGIN: origin, DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const [output] = await once(child.stdout, 'data');
    const port = JSON.parse(String(output).match(/listening on (.*); dashboard/)[1]).port;
    const url = `http://127.0.0.1:${port}/__codex_addon/expiry`;
    const headers = { origin, cookie: 'session=test', 'content-type': 'application/json', 'x-codex-addon': '1' };
    const put = (value, extra = {}) => fetch(url, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type,x-codex-addon' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal((await fetch(url, { headers: { origin } })).status, 401);
    const versionUrl = url.replace('/expiry', '/version');
    assert.equal((await fetch(versionUrl, { headers: { origin } })).status, 401);
    const metadata = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
    assert.equal((await (await fetch(versionUrl, { headers })).json()).version, metadata.version);
    const updatesUrl = url.replace('/expiry', '/updates');
    assert.equal((await fetch(updatesUrl, { method: 'POST', headers: { origin, cookie: 'session=test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(updatesUrl, { method: 'POST', headers, body: JSON.stringify({ version: '1.1.0', releaseId: 123 }) })).status, 409, 'direct service requires supervisor before installing');
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await put({ id: 'c1', expiry: '2026-12-31' }, { origin: 'http://attacker.test' })).status, 403);
    assert.equal((await put({ id: 'c1', expiry: '2026-12-31' }, { 'x-codex-addon': '' })).status, 403);
    for (const value of [null, [], { id: 'c1', expiry: 123 }, { id: 'c1', expiry: 'x'.repeat(501) }, { id: '../c1', expiry: '' }]) assert.equal((await put(value)).status, 400);
    assert.equal((await put({ id: 'c1', expiry: '2026-12-31', padding: 'x'.repeat(5000) })).status, 413);
    const writes = await Promise.all([put({ id: 'c1', expiry: '25/11/2026' }), put({ id: 'c2', expiry: 'Chờ admin gia hạn' })]);
    assert.deepEqual(writes.map(res => res.status), [200, 200]);
    const expected = { c1: '25/11/2026', c2: 'Chờ admin gia hạn' };
    assert.deepEqual(await (await fetch(url, { headers })).json(), expected);
    assert.deepEqual(JSON.parse(await readFile(path.join(data, 'package-expiry.json'), 'utf8')), expected);
    assert.equal((await put({ id: 'c1', expiry: '' })).status, 200);
    assert.deepEqual(await (await fetch(url, { headers })).json(), { c2: 'Chờ admin gia hạn' });
  } finally {
    child.kill(); await once(child, 'exit'); upstream.close(); await rm(data, { recursive: true, force: true });
  }
});
