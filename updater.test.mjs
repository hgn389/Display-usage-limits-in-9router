import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compareVersions, checkUpdate, createBundle, validateBundle, installBundle, installUpdate, sha256, repository } from './updater.mjs';
import { prepare, change } from './native-ui.mjs';

function withVersion(bundle, version) {
  const copy = structuredClone(bundle); copy.version = version;
  for (const file of copy.files) {
    if (file.path === 'client.js') {
      const bytes = Buffer.from(Buffer.from(file.content, 'base64').toString().replace(/(^\/\/ @version\s+)\S+/m, `$1${version}`));
      file.content = bytes.toString('base64'); file.sha256 = sha256(bytes);
    }
    if (!['package.json', 'package-lock.json'].includes(file.path)) continue;
    const metadata = JSON.parse(Buffer.from(file.content, 'base64'));
    metadata.version = version;
    if (metadata.packages?.['']) metadata.packages[''].version = version;
    const bytes = Buffer.from(JSON.stringify(metadata));
    file.content = bytes.toString('base64'); file.sha256 = sha256(bytes);
  }
  return copy;
}

test('stable version checks reject invalid versions and handle multi-digit versions', () => {
  assert.equal(compareVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  for (const version of ['v1.0.0-beta', 'latest', '1.02.0', '../1.0.0', '', null]) assert.throws(() => compareVersions(version, '1.0.0'));
});

test('release checks handle no release, current version, missing package, and wrong download host', async () => {
  const root = path.dirname(new URL(import.meta.url).pathname);
  let fixture = new Response('{}', { status: 404 });
  const fetcher = async url => { assert.equal(url, `https://api.github.com/repos/${repository}/releases/latest`); return fixture; };
  assert.match((await checkUpdate(root, fetcher)).message, /No published releases/);
  const release = { id: 123, tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [] };
  fixture = Response.json(release); assert.equal((await checkUpdate(root, fetcher)).available, false);
  release.tag_name = 'v1.1.0'; fixture = Response.json(release);
  assert.match((await checkUpdate(root, fetcher)).message, /no update package/);
  release.assets = [{ name: '9router-addon-v1.1.0.json', browser_download_url: 'https://attacker.test/payload', size: 100 }];
  fixture = Response.json(release); await assert.rejects(checkUpdate(root, fetcher), /Invalid update asset/);
  release.assets[0].browser_download_url = `https://github.com/${repository}/releases/download/v1.1.0/9router-addon-v1.1.0.json`;
  fixture = Response.json(release); assert.equal((await checkUpdate(root, fetcher)).available, true);
  release.prerelease = true; fixture = Response.json(release); await assert.rejects(checkUpdate(root, fetcher), /Invalid published release/);
});

test('update package allowlist rejects traversal, damaged files, wrong version and added dependencies', async () => {
  const bundle = withVersion(await createBundle(), '1.0.0');
  assert.ok(validateBundle(bundle, '1.0.0').has('client.js'));
  const traversal = structuredClone(bundle); traversal.files[0].path = '../data/expiry.json';
  assert.throws(() => validateBundle(traversal, '1.0.0'), /Invalid update file/);
  const broken = structuredClone(bundle); broken.files[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateBundle(broken, '1.0.0'), /checksum/);
  assert.throws(() => validateBundle(bundle, '1.0.1'), /Invalid update package/);
  const dependencies = structuredClone(bundle), file = dependencies.files.find(f => f.path === 'package.json');
  const metadata = JSON.parse(Buffer.from(file.content, 'base64')); metadata.dependencies = { unexpected: '1' };
  const bytes = Buffer.from(JSON.stringify(metadata)); file.content = bytes.toString('base64'); file.sha256 = sha256(bytes);
  assert.throws(() => validateBundle(dependencies, '1.0.0'), /Unsupported update runtime/);
});

test('installer rolls back failed UI patch, preserves notes, prevents downgrade and accepts a later update', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-install-'));
  try {
    const bundle = withVersion(await createBundle(), '1.0.0');
    for (const file of bundle.files) await writeFile(path.join(root, file.path), Buffer.from(file.content, 'base64'));
    await mkdir(path.join(root, 'data')); await writeFile(path.join(root, 'data', 'package-expiry.json'), '{"account":"private note"}');
    const next = withVersion(bundle, '1.1.0');
    await assert.rejects(installBundle(root, next, '1.1.0', async () => { throw new Error('UI changed'); }), /UI changed/);
    assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'))).version, '1.0.0');
    await assert.rejects(readFile(path.join(root, '.updates', 'installed.json')), { code: 'ENOENT' });
    assert.equal((await installBundle(root, next, '1.1.0', async () => {})).version, '1.1.0');
    assert.equal(await readFile(path.join(root, 'data', 'package-expiry.json'), 'utf8'), '{"account":"private note"}');
    await assert.rejects(installBundle(root, next, '1.1.0', async () => {}), /downgrade/);
    const later = withVersion(bundle, '1.2.0');
    await writeFile(path.join(root, 'client.js'), '// local modification');
    await assert.rejects(installBundle(root, later, '1.2.0', async () => {}), /Local source changes/);
    await writeFile(path.join(root, 'client.js'), Buffer.from(next.files.find(f => f.path === 'client.js').content, 'base64'));
    assert.equal((await installBundle(root, later, '1.2.0', async () => {})).version, '1.2.0');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release install rechecks selected release and rejects an asset digest mismatch before any writes', async () => {
  const version = '1.1.0', id = 123;
  const release = { id, tag_name: `v${version}`, draft: false, prerelease: false, assets: [{ name: `9router-addon-v${version}.json`, size: 100, digest: `sha256:${'0'.repeat(64)}`, browser_download_url: `https://github.com/${repository}/releases/download/v${version}/9router-addon-v${version}.json` }] };
  const fetcher = async url => url.includes('api.github.com') ? Response.json(release) : new Response('{}');
  await assert.rejects(installUpdate({ version, releaseId: 124 }, undefined, fetcher), /Release changed/);
  await assert.rejects(installUpdate({ version, releaseId: id }, undefined, fetcher), /digest missing or mismatched/);
});

test('published package installs through the real native updater using an isolated mock 9router app', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-release-e2e-'));
  const previousApp = process.env.ROUTER_APP_DIR;
  try {
    const bundle = await createBundle();
    for (const file of bundle.files) await writeFile(path.join(root, file.path), Buffer.from(file.content, 'base64'));
    const app = path.join(root, 'mock-app');
    const dir = path.join(app, '.next-cli-build/static/chunks/app/(dashboard)/dashboard/providers/[id]');
    await mkdir(dir, { recursive: true });
    const asset = path.join(dir, 'page-fixture.js');
    await writeFile(asset, 'const fixture = {children:"Connections"};');
    const work = path.join(root, '.native-ui');
    await prepare(app, work); await change(app, work, 'apply');
    process.env.ROUTER_APP_DIR = app;
    const next = withVersion(bundle, '1.1.0');
    const content = JSON.stringify(next);
    const release = { id: 123, tag_name: 'v1.1.0', draft: false, prerelease: false, assets: [{ name: '9router-addon-v1.1.0.json', size: Buffer.byteLength(content), digest: `sha256:${sha256(content)}`, browser_download_url: `https://github.com/${repository}/releases/download/v1.1.0/9router-addon-v1.1.0.json` }] };
    const result = await installUpdate({ version: '1.1.0', releaseId: 123 }, root, async url => url.includes('api.github.com') ? Response.json(release) : new Response(content));
    assert.equal(result.version, '1.1.0');
    assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'))).version, '1.1.0');
    const state = JSON.parse(await readFile(path.join(work, 'state.json')));
    assert.equal(sha256(await readFile(asset)), state.candidateHash);
    assert.equal(await readFile(path.join(work, 'original.js'), 'utf8'), 'const fixture = {children:"Connections"};');
  } finally {
    if (previousApp === undefined) delete process.env.ROUTER_APP_DIR; else process.env.ROUTER_APP_DIR = previousApp;
    await rm(root, { recursive: true, force: true });
  }
});
