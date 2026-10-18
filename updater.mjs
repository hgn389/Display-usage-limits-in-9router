import { readFile, writeFile, mkdir, rename, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const repository = 'hgn389/Display-usage-limits-in-9router';
export const releaseFiles = ['package.json', 'package-lock.json', 'client.js', 'native-ui.mjs', 'expiry-server.mjs', 'updater.mjs', 'service.mjs', 'server.mjs', 'validation.mjs', 'Readme.md', 'Readme-vi.md', 'INSTALL.txt', 'LICENSE'];
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
const maxBytes = 4 * 1024 * 1024;

export function compareVersions(a, b) {
  const parse = text => {
    if (typeof text !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text)) throw new Error('Invalid stable version');
    const parts = text.replace(/^v/, '').split('.').map(Number);
    if (parts.some(n => !Number.isSafeInteger(n))) throw new Error('Invalid version');
    return parts;
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function request(url, fetcher) {
  const response = await fetcher(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': '9router-usage-limits-addon' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error(`GitHub returned HTTP ${response.status}`); error.status = response.status; throw error;
  }
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Update response too large');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Update response too large');
    chunks.push(Buffer.from(chunk));
  }
  return { body: Buffer.concat(chunks), response };
}

export async function checkUpdate(root = here, fetcher = fetch) {
  const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  let release;
  try { release = JSON.parse((await request(`https://api.github.com/repos/${repository}/releases/latest`, fetcher)).body); }
  catch (error) { if (error.status === 404) return { current, available: false, message: 'No published releases yet' }; throw error; }
  if (release.draft || release.prerelease || typeof release.id !== 'number') throw new Error('Invalid published release');
  const newer = compareVersions(release.tag_name, current) > 0;
  const version = release.tag_name.replace(/^v/, '');
  const asset = release.assets?.find(item => item.name === `9router-addon-v${version}.json`);
  if (!newer) return { current, available: false, message: 'Up to date' };
  if (!asset) return { current, available: false, message: `Release v${version} has no update package` };
  const expected = `https://github.com/${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${asset.name}`;
  if (asset.browser_download_url !== expected || asset.size > maxBytes) throw new Error('Invalid update asset');
  return { current, version, releaseId: release.id, available: true, url: expected, digest: asset.digest || null, message: `Update v${version} available` };
}

export function validateBundle(bundle, version) {
  if (!bundle || bundle.schema !== 1 || bundle.repository !== repository || bundle.version !== version || !Array.isArray(bundle.files)) throw new Error('Invalid update package');
  compareVersions(version, '0.0.0');
  if (bundle.files.length !== releaseFiles.length) throw new Error('Incomplete update package');
  const entries = new Map();
  for (const file of bundle.files) {
    if (!releaseFiles.includes(file.path) || entries.has(file.path) || typeof file.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw new Error('Invalid update file');
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.length > 1024 * 1024 || sha256(bytes) !== file.sha256) throw new Error('Update checksum mismatch');
    entries.set(file.path, bytes);
  }
  const metadata = JSON.parse(entries.get('package.json').toString());
  if (metadata.name !== '9router-codex-addon' || metadata.version !== version || Object.keys(metadata.dependencies || {}).length) throw new Error('Unsupported update runtime');
  const lock = JSON.parse(entries.get('package-lock.json').toString());
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('Update version mismatch');
  const clientVersion = entries.get('client.js').toString().match(/^\/\/ @version\s+(\S+)/m)?.[1];
  if (clientVersion !== version) throw new Error('Client version mismatch');
  return entries;
}

export async function createBundle(root = here) {
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const files = [];
  for (const name of releaseFiles) {
    const bytes = await readFile(path.join(root, name));
    files.push({ path: name, sha256: sha256(bytes), content: bytes.toString('base64') });
  }
  const bundle = { schema: 1, repository, version, files };
  validateBundle(bundle, version);
  return bundle;
}

async function atomic(file, bytes, mode = 0o644) {
  const temporary = `${file}.update-${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode, flag: 'wx' });
  await rename(temporary, file);
}

// Never writes data/, installed 9router server code, authentication or Git metadata.
export async function installBundle(root, bundle, version, applyNative) {
  const entries = validateBundle(bundle, version);
  const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  if (compareVersions(version, current) <= 0) throw new Error('Refusing same-version update or downgrade');
  const updates = path.join(root, '.updates');
  await mkdir(updates, { recursive: true, mode: 0o700 });
  const lock = path.join(updates, 'install.lock');
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const backup = path.join(updates, `${Date.now()}-${process.pid}-before-v${version}`);
  const before = new Map();
  const replaced = [];
  const ledgerFile = path.join(updates, 'installed.json');
  let ledgerBefore = null, ledgerWritten = false;
  try {
    try { ledgerBefore = await readFile(ledgerFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (ledgerBefore) {
      const ledger = JSON.parse(ledgerBefore);
      for (const name of releaseFiles) if (sha256(await readFile(path.join(root, name))) !== ledger.files?.[name]) throw new Error('Local source changes found; back them up before installing');
    } else {
      try {
        const status = await exec('git', ['status', '--porcelain', '--untracked-files=no', '--', ...releaseFiles], { cwd: root });
        if (status.stdout.trim()) throw new Error('Local source changes found; commit or back them up before installing');
      } catch (error) { if (!String(error.stderr || '').includes('not a git repository')) throw error; }
    }
    await mkdir(backup, { mode: 0o700 });
    for (const [name] of entries) {
      const target = path.join(root, name);
      let old = null, mode = 0o644;
      try {
        const info = await lstat(target);
        if (!info.isFile()) throw new Error('Update target must be a regular file');
        old = await readFile(target); mode = info.mode & 0o777;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      before.set(name, { bytes: old, mode });
      if (old) await writeFile(path.join(backup, name), old, { mode: 0o600 });
    }
    for (const [name, bytes] of entries) {
      if (/\.(mjs|js)$/.test(name)) {
        const staged = path.join(backup, `next-${name}`);
        await writeFile(staged, bytes, { mode: 0o600 });
        await exec(process.execPath, ['--check', staged], { timeout: 10000 });
      }
    }
    for (const [name, bytes] of entries) {
      await atomic(path.join(root, name), bytes, before.get(name).mode); replaced.push(name);
    }
    await atomic(ledgerFile, JSON.stringify({ version, files: Object.fromEntries([...entries].map(([name, bytes]) => [name, sha256(bytes)])) }), 0o600);
    ledgerWritten = true;
    await applyNative();
  } catch (error) {
    for (const name of replaced.reverse()) {
      const old = before.get(name);
      if (old.bytes) await atomic(path.join(root, name), old.bytes, old.mode);
      else await unlink(path.join(root, name));
    }
    if (ledgerWritten) {
      if (ledgerBefore) await atomic(ledgerFile, ledgerBefore, 0o600);
      else await unlink(ledgerFile);
    }
    throw error;
  } finally { await unlink(lock); }
  return { version, backup: path.basename(backup) };
}

export async function installUpdate(selection, root = here, fetcher = fetch) {
  const latest = await checkUpdate(root, fetcher);
  if (!latest.available || selection.version !== latest.version || selection.releaseId !== latest.releaseId) throw new Error('Release changed; check updates again');
  const { body } = await request(latest.url, fetcher);
  if (!/^sha256:[a-f0-9]{64}$/.test(latest.digest || '') || `sha256:${sha256(body)}` !== latest.digest) throw new Error('Published asset digest missing or mismatched');
  const bundle = JSON.parse(body);
  return installBundle(root, bundle, latest.version, async () => {
    await exec(process.execPath, [path.join(root, 'native-ui.mjs'), 'update'], { cwd: root, timeout: 30000 });
  });
}
