// Dev runner: `tsc --watch` + `node --watch` side by side (no extra dependency).
// A plain esbuild-based runner (tsx) would not emit decorator metadata that NestJS needs.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const tscArgs = [tsc, '-p', 'tsconfig.build.json'];

// Build once so dist/main.js exists before the watchers start.
const first = spawnSync(process.execPath, tscArgs, { stdio: 'inherit' });
if (first.status !== 0) {
  process.exit(first.status ?? 1);
}

const children = [
  spawn(process.execPath, [...tscArgs, '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--env-file-if-exists=../../.env', '--watch', 'dist/main.js'], {
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
