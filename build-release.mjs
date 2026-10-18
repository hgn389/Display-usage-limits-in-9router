import { mkdir, writeFile } from 'node:fs/promises';
import { createBundle, sha256 } from './updater.mjs';

const bundle = await createBundle();
const name = `9router-addon-v${bundle.version}.json`;
const body = JSON.stringify(bundle);
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL(`./dist/${name}`, import.meta.url), body);
await writeFile(new URL(`./dist/${name}.sha256`, import.meta.url), `${sha256(body)}  ${name}\n`);
console.log(`Built dist/${name} and SHA-256 checksum. Nothing uploaded.`);
