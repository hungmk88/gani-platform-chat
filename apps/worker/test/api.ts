import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { requireEnv, waitFor } from './harness.js';

// The API as a real process (`apps/api/dist/main.js`, built by the queue job of CI), for the end-to-end test of realtime: the webhook
// and the sockets are its own. It gets what a deployment gives it, with the waits of a test.

const apiDir = resolve(import.meta.dirname, '../../api');

/** The origin the API trusts (BETTER_AUTH_URL): every request and socket of a test sends it as `origin`. */
export const API_ORIGIN = 'http://localhost:3000';

export interface ApiProcess {
  readonly url: string;
  /** The last lines it printed, for the message of a failure. */
  tail(): string;
  /** Everything it printed so far, stdout and stderr. */
  output(): string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** Starts the API with Valkey (REDIS_URL) and the given channel key, and waits for /healthz. */
export async function spawnApi(channelKey: string): Promise<ApiProcess> {
  const port = await freePort();
  const lines: string[] = [];
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiDir,
    env: {
      PATH: process.env['PATH'],
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_ENV: 'test',
      AUTH_ALLOW_HTTP: 'true',
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      BETTER_AUTH_URL: API_ORIGIN,
      DATABASE_URL_APP: requireEnv('DATABASE_URL_APP'),
      DATABASE_URL_AUTH: requireEnv('DATABASE_URL_AUTH'),
      REDIS_URL: requireEnv('REDIS_URL'),
      CHANNEL_SECRET_KEY_1: channelKey,
    },
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n')));
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  const url = `http://127.0.0.1:${port}`;
  const tail = () => lines.slice(-40).join('\n');
  try {
    await waitFor(async () => (await fetch(`${url}/healthz`).catch(() => null))?.status === 200, {
      timeoutMs: 30_000,
      everyMs: 250,
      label: `the API to answer /healthz\n${tail()}`,
      report: false,
    });
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return {
    url,
    tail,
    output: () => lines.join('\n'),
    async stop() {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))]);
      child.kill('SIGKILL');
    },
  };
}
