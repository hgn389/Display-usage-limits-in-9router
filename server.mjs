import http from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';
import { validDate } from './validation.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const upstream = new URL(process.env.UPSTREAM || 'http://127.0.0.1:9090');
if (upstream.protocol !== 'http:') throw new Error('UPSTREAM must use HTTP on a trusted local network');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataFile = path.join(dataDir, 'expiry.json');
let pending = Promise.resolve();
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function load() {
  try { return JSON.parse(await readFile(dataFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function authorized(req) {
  const result = await fetch(new URL('/api/auth/status', upstream), {
    headers: { cookie: req.headers.cookie || '' }, redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  if (!result.ok) return false;
  const status = await result.json();
  return status.authenticated === true || status.requireLogin === false;
}
async function addon(req, res, url) {
  if (url.pathname === '/__codex_addon/client.js' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(await readFile(path.join(root, 'client.js')));
    return;
  }
  if (url.pathname !== '/__codex_addon/expiry') return json(res, 404, { error: 'Not found' });
  if (!await authorized(req)) return json(res, 401, { error: 'Dashboard login required' });
  if (req.method === 'GET') return json(res, 200, await load());
  if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
  // Only same-origin browser mutations are accepted; never trust forwarded Host headers.
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-codex-addon'] !== '1') {
    return json(res, 403, { error: 'Same-origin request required' });
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) return json(res, 413, { error: 'Payload too large' });
  }
  let value;
  try { value = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
  if (!/^[\w-]{1,128}$/.test(value.id || '') || !validDate(value.expiry)) {
    return json(res, 400, { error: 'Invalid connection ID or date' });
  }
  const operation = pending.then(async () => {
    const values = await load();
    if (value.expiry) values[value.id] = value.expiry;
    else delete values[value.id];
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(`${dataFile}.tmp`, JSON.stringify(values, null, 2), { mode: 0o600 });
    await rename(`${dataFile}.tmp`, dataFile);
  });
  pending = operation.catch(() => {});
  await operation;
  json(res, 200, { ok: true });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://addon.local');
  if (url.pathname.startsWith('/__codex_addon/')) {
    try { await addon(req, res, url); }
    catch { if (!res.headersSent) json(res, 502, { error: 'Addon storage or authentication unavailable' }); else res.destroy(); }
    return;
  }
  const headers = { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' };
  delete headers['x-9r-cli-token'];
  delete headers['x-forwarded-for'];
  delete headers['x-real-ip'];
  headers['x-forwarded-for'] = req.socket.remoteAddress;
  const target = new URL(upstream);
  target.pathname = url.pathname;
  target.search = url.search;
  const proxy = http.request(target, { method: req.method, headers }, response => {
    const html = req.method === 'GET' && String(response.headers['content-type']).includes('text/html');
    if (!html) {
      res.writeHead(response.statusCode, response.headers);
      pipeline(response, res, () => {});
      return;
    }
    const chunks = [];
    let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) { response.destroy(); res.destroy(); return; }
      chunks.push(chunk);
    });
    response.on('error', () => res.destroy());
    response.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf8').replace('</body>', '<script src="/__codex_addon/client.js" defer></script></body>');
      const outputHeaders = { ...response.headers, 'cache-control': 'no-store' };
      delete outputHeaders['content-length'];
      delete outputHeaders['content-encoding'];
      delete outputHeaders.etag;
      res.writeHead(response.statusCode, outputHeaders);
      res.end(content);
    });
  });
  proxy.on('error', () => { if (!res.headersSent) json(res, 502, { error: '9router unavailable' }); else res.destroy(); });
  req.on('aborted', () => proxy.destroy());
  pipeline(req, proxy, () => {});
});
server.listen(Number(process.env.PORT || 9091), process.env.HOST || '127.0.0.1', () => {
  console.log(`Codex addon listening on ${JSON.stringify(server.address())}; upstream ${upstream.origin}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
