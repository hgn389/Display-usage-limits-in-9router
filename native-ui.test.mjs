import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepare, change, update } from './native-ui.mjs';

test('native installer prepares without mutation, applies and restores exactly, and refuses changed assets', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'codex-native-ui-'));
  try {
    const app = path.join(base, 'app');
    const work = path.join(base, 'backup');
    const dir = path.join(app, '.next-cli-build/static/chunks/app/(dashboard)/dashboard/providers/[id]');
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, 'page-test.js');
    const original = 'const example = {children:"Connections"};';
    await writeFile(target, original);
    await prepare(app, work);
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal((await change(app, work, 'apply')).changed, true);
    const patched = await readFile(target, 'utf8');
    assert.match(patched, /const nativeMode = true/);
    assert.equal((await change(app, work, 'apply')).changed, false);
    assert.equal((await update(app, work)).changed, false);
    // Simulate an earlier addon revision, keeping its recorded checksums valid.
    const previous = `${patched}\n// previous revision\n`;
    const stateFile = path.join(work, 'state.json');
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    state.candidateHash = createHash('sha256').update(previous).digest('hex');
    await writeFile(target, previous);
    await writeFile(path.join(work, 'candidate.js'), previous);
    await writeFile(stateFile, JSON.stringify(state));
    assert.equal((await update(app, work)).changed, true);
    assert.equal(await readFile(target, 'utf8'), patched);
    assert.equal(await readFile(path.join(work, 'original.js'), 'utf8'), original);
    assert.equal((await change(app, work, 'restore')).changed, true);
    assert.equal(await readFile(target, 'utf8'), original);
    await writeFile(target, 'an unrelated update');
    await assert.rejects(change(app, work, 'apply'), /refusing to overwrite/);
    await assert.rejects(change(app, work, 'restore'), /refusing to overwrite/);
    await assert.rejects(update(app, work), /refusing to overwrite/);
    assert.equal(await readFile(target, 'utf8'), 'an unrelated update');
  } finally { await rm(base, { recursive: true, force: true }); }
});
