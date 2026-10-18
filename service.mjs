import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let child, stopping = false;
function start() {
  child = fork(fileURLToPath(new URL('./expiry-server.mjs', import.meta.url)), [], {
    stdio: 'inherit', env: { ...process.env, ADDON_UPDATE_RESTART: '1' }
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code === 75) return start();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(signal); });
start();
