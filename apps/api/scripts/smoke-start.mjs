// Start-up smoke test (review A-01): runs the BUILT API (`dist/main.js`) as a real process and asks `/healthz`.
// `pnpm build` and the unit tests cannot see a runtime import that Node cannot load (a workspace package that exports TypeScript,
// for example), because tsc and vitest both read `.ts`. Needs no database: the pool is lazy and `/healthz` does not touch it.
// Every value is made up here for this run; nothing is read from the caller's environment, so no real secret can reach this process.
import { spawn } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { get } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 30_000;
const POLL_MS = 250;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const env = {
  PATH: process.env.PATH ?? '',
  PORT: String(port),
  HOST: '127.0.0.1',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: 'https://smoke.example.test',
  // Port 1 refuses at once; the pool is lazy, so nothing connects before a query.
  DATABASE_URL_AUTH: `postgres://auth_role:${randomBytes(12).toString('hex')}@127.0.0.1:1/smoke`,
};
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let exited = null;
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => (output += chunk));
child.once('exit', (code, signal) => (exited = { code, signal }));

function answers() {
  return new Promise((resolve) => {
    const request = get(`http://127.0.0.1:${port}/healthz`, { timeout: 2_000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

const deadline = Date.now() + TIMEOUT_MS;
let ok = false;
while (Date.now() < deadline && exited === null) {
  if (await answers()) {
    ok = true;
    break;
  }
  await sleep(POLL_MS);
}
child.kill();

if (ok) {
  console.log(`smoke: dist/main.js started and /healthz answered 200 on port ${port}`);
} else {
  const why = exited
    ? `the process exited (code ${exited.code})`
    : `no answer within ${TIMEOUT_MS} ms`;
  console.error(`smoke: FAILED, ${why}. Output of the process:\n${output.trim().slice(-2000)}`);
  process.exitCode = 1;
}
