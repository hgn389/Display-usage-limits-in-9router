import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpdate, installUpdate } from './updater.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const upstream = new URL(process.env.UPSTREAM || 'http://127.0.0.1:9090');
const dashboardOrigin = new URL(process.env.DASHBOARD_ORIGIN || 'http://127.0.0.1:9090').origin;
if (upstream.protocol !== 'http:') throw new Error('UPSTREAM must use trusted local HTTP');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataFile = path.join(dataDir, 'package-expiry.json');
const validId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const validNote = value => typeof value === 'string' && value.length <= 500;
let pending = Promise.resolve();
let updateBusy = false;
let releaseCache = null, releaseCacheAt = 0;
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;

async function load() {
  let data;
  try { data = JSON.parse(await readFile(dataFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return Object.create(null); throw error; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([id, note]) => !validId(id) || !validNote(note))) throw new Error('Invalid stored expiry data');
  return Object.assign(Object.create(null), data);
}

const server = http.createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.headers.origin !== dashboardOrigin) return json(403, { error: 'Dashboard origin required' });
    res.setHeader('access-control-allow-origin', dashboardOrigin);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('vary', 'Origin');
    if (!['/__codex_addon/expiry', '/__codex_addon/updates', '/__codex_addon/version'].includes(req.url)) return json(404, { error: 'Not found' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': 'content-type, x-codex-addon', 'access-control-max-age': '600' });
      return res.end();
    }
    const updateRoute = req.url === '/__codex_addon/updates';
    const allowed = req.url === '/__codex_addon/version' ? ['GET'] : updateRoute ? ['GET', 'POST'] : ['GET', 'PUT'];
    if (!allowed.includes(req.method)) return json(405, { error: 'Method not allowed' });
    const auth = await fetch(new URL('/api/auth/status', upstream), {
      headers: { cookie: req.headers.cookie || '' }, redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    if (!auth.ok) return json(401, { error: 'Dashboard login required' });
    const status = await auth.json();
    if (status.authenticated !== true && status.requireLogin !== false) return json(401, { error: 'Dashboard login required' });
    if (req.url === '/__codex_addon/version') return json(200, { version, updating: updateBusy });
    if (updateRoute && req.method === 'GET') {
      if (!releaseCache || Date.now() - releaseCacheAt >= 60000) {
        try { releaseCache = await checkUpdate(); releaseCacheAt = Date.now(); }
        catch { return json(502, { error: 'Cannot check GitHub releases. Try again later.' }); }
      }
      const { url, digest, ...result } = releaseCache;
      return json(200, { ...result, installEnabled: process.env.ADDON_UPDATE_RESTART === '1' });
    }
    if (req.method === 'GET') return json(200, await load());
    if (req.headers['x-codex-addon'] !== '1') return json(403, { error: 'Addon header required' });
    if (updateBusy) return json(409, { error: 'Addon update in progress. Retry after it completes.' });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= 4096) chunks.push(chunk);
    }
    if (size > 4096) return json(413, { error: 'Payload too large' });
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return json(400, { error: 'Invalid JSON' }); }
    if (updateRoute) {
      if (process.env.ADDON_UPDATE_RESTART !== '1') return json(409, { error: 'Start the addon with node service.mjs before installing updates.' });
      if (!value || typeof value.version !== 'string' || !Number.isSafeInteger(value.releaseId)) return json(400, { error: 'Invalid release selection' });
      // Claim the lock after body parsing, then drain previously accepted note writes.
      if (updateBusy) return json(409, { error: 'Addon update already in progress' });
      updateBusy = true;
      try {
        await pending;
        const result = await installUpdate(value);
        res.once('finish', () => {
          server.close(() => process.exit(75));
          setTimeout(() => process.exit(75), 3000).unref();
        });
        return json(200, { ok: true, version: result.version, restarting: true });
      } catch (error) {
        updateBusy = false;
        const message = error.message.startsWith('Local source changes') ? error.message : 'Update failed; addon source was preserved or restored. Check the release and retry.';
        return json(409, { error: message });
      }
    }
    if (updateBusy) return json(409, { error: 'Addon update in progress' });
    if (!value || typeof value !== 'object' || !validId(value.id) || !validNote(value.expiry)) return json(400, { error: 'Invalid connection ID or note' });
    const operation = pending.then(async () => {
      const data = await load();
      if (value.expiry) data[value.id] = value.expiry;
      else delete data[value.id];
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporary = `${dataFile}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(temporary, dataFile);
    });
    pending = operation.catch(() => {});
    await operation;
    json(200, { ok: true });
  } catch { if (!res.headersSent) json(502, { error: 'Expiry storage or dashboard authentication unavailable' }); else res.destroy(); }
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT || 9092), process.env.HOST || '127.0.0.1', () => {
  console.log(`Expiry storage listening on ${JSON.stringify(server.address())}; dashboard ${dashboardOrigin}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
