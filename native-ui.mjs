import { readFile, readdir, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const marker = '/* 9router-codex-quota-only:v1 */';
const modeFlag = 'const nativeMode = false; // Native installer sets this to true.';
const digest = value => createHash('sha256').update(value).digest('hex');

export function nativeSource(source) {
  if (source.split(modeFlag).length !== 2) throw new Error('Unrecognized client mode flag');
  return source.replace(modeFlag, 'const nativeMode = true;');
}

async function assetPath(appDir) {
  const dir = path.join(appDir, '.next-cli-build/static/chunks/app/(dashboard)/dashboard/providers/[id]');
  const files = (await readdir(dir)).filter(name => /^page-.*\.js$/.test(name));
  if (files.length !== 1) throw new Error('Expected exactly one provider detail UI asset');
  return path.join(dir, files[0]);
}

// Preparation writes only to the addon directory. It never changes 9router.
async function buildCandidate(original) {
  const source = nativeSource(await readFile(path.join(root, 'client.js'), 'utf8'));
  const candidate = `${original}\n;${marker}\n(() => {\nconst mount = () => {\n${source}\n};\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });\nelse mount();\n})();\n`;
  new Script(candidate, { filename: 'prepared-provider-ui.js' });
  return candidate;
}

export async function prepare(appDir, workDir) {
  const target = await assetPath(appDir);
  const original = await readFile(target, 'utf8');
  if (original.includes(marker)) throw new Error('Native patch already present; restore before preparing again');
  if (!original.includes('children:"Connections"')) throw new Error('Unrecognized provider detail UI');
  const candidate = await buildCandidate(original);
  const state = { target, originalHash: digest(original), candidateHash: digest(candidate), mode: (await stat(target)).mode & 0o777 };
  await mkdir(workDir, { mode: 0o700 });
  await writeFile(path.join(workDir, 'original.js'), original, { mode: 0o600 });
  await writeFile(path.join(workDir, 'candidate.js'), candidate, { mode: 0o600 });
  await writeFile(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}

export async function update(appDir, workDir) {
  const state = JSON.parse(await readFile(path.join(workDir, 'state.json'), 'utf8'));
  if (state.target !== await assetPath(appDir)) throw new Error('UI asset changed; refusing to overwrite it');
  const original = await readFile(path.join(workDir, 'original.js'), 'utf8');
  const previous = await readFile(path.join(workDir, 'candidate.js'), 'utf8');
  if (digest(original) !== state.originalHash || digest(previous) !== state.candidateHash) throw new Error('Prepared files changed');
  if (digest(await readFile(state.target)) !== state.candidateHash) throw new Error('Installed UI changed; refusing to overwrite it');
  const candidate = await buildCandidate(original);
  if (digest(candidate) === state.candidateHash) return { changed: false, target: state.target };
  const revision = path.join(workDir, 'revisions', `${Date.now()}-${process.pid}`);
  await mkdir(revision, { recursive: true, mode: 0o700 });
  await writeFile(path.join(revision, 'candidate.js'), previous, { mode: 0o600 });
  await writeFile(path.join(revision, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  const nextState = { ...state, candidateHash: digest(candidate) };
  try {
    await replaceAsset(path.join(workDir, 'candidate.js'), candidate, 0o600);
    await replaceAsset(path.join(workDir, 'state.json'), JSON.stringify(nextState, null, 2), 0o600);
    await replaceAsset(state.target, candidate, state.mode);
  } catch (error) {
    await replaceAsset(path.join(workDir, 'candidate.js'), previous, 0o600);
    await replaceAsset(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2), 0o600);
    throw error;
  }
  return { changed: true, target: state.target };
}

async function replaceAsset(target, content, mode) {
  const temporary = `${target}.codex-addon-${process.pid}.tmp`;
  await writeFile(temporary, content, { mode, flag: 'wx' });
  await rename(temporary, target);
}

// Apply and restore refuse to overwrite any unexpected changes or update.
export async function change(appDir, workDir, action) {
  if (!['apply', 'restore'].includes(action)) throw new Error('Invalid action');
  const state = JSON.parse(await readFile(path.join(workDir, 'state.json'), 'utf8'));
  if (state.target !== await assetPath(appDir)) throw new Error('UI asset changed; prepare for the current 9router version');
  const original = await readFile(path.join(workDir, 'original.js'), 'utf8');
  const candidate = await readFile(path.join(workDir, 'candidate.js'), 'utf8');
  if (digest(original) !== state.originalHash || digest(candidate) !== state.candidateHash) throw new Error('Prepared files changed');
  const currentHash = digest(await readFile(state.target));
  const before = action === 'apply' ? state.originalHash : state.candidateHash;
  const after = action === 'apply' ? state.candidateHash : state.originalHash;
  if (currentHash === after) return { changed: false, target: state.target };
  if (currentHash !== before) throw new Error('Installed UI changed; refusing to overwrite it');
  await replaceAsset(state.target, action === 'apply' ? candidate : original, state.mode);
  return { changed: true, target: state.target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const appDir = path.resolve(process.argv[3] || process.env.ROUTER_APP_DIR || '/usr/lib/node_modules/9router/app');
  const workDir = path.join(root, '.native-ui');
  try {
    if (action === 'prepare') {
      const state = await prepare(appDir, workDir);
      console.log(`Prepared native addon UI for ${state.target}. Installed package unchanged.`);
    } else if (action === 'update') {
      const result = await update(appDir, workDir);
      console.log(`update: ${result.changed ? 'updated' : 'already current'} ${result.target}`);
    } else if (['apply', 'restore'].includes(action)) {
      const result = await change(appDir, workDir, action);
      console.log(`${action}: ${result.changed ? 'updated' : 'already in requested state'} ${result.target}`);
    } else throw new Error('Usage: node native-ui.mjs prepare|apply|update|restore [9router-app-directory]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
