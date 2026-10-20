import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RequestContextMissingError,
  currentRequestContext,
  runWithRequestContext,
  type RequestContext,
} from './request-context.js';

const ctxOf = (userId: string, workspaceIds: string[] = []): RequestContext => ({
  userId,
  orgId: randomUUID(),
  role: 'sales',
  workspaceIds,
  resolvedAt: new Date(),
  traceId: 'trace-test',
});

describe('currentRequestContext', () => {
  it('throws outside a request instead of returning a default', () => {
    expect(() => currentRequestContext()).toThrow(RequestContextMissingError);
  });

  it('throws again once the work inside has finished (nothing is left behind)', async () => {
    await runWithRequestContext(ctxOf('u1'), async () => {
      await sleep(1);
      expect(currentRequestContext().userId).toBe('u1');
    });
    expect(() => currentRequestContext()).toThrow(RequestContextMissingError);
  });

  it('is frozen: a handler cannot change its role or add a workspace', () => {
    const ws = randomUUID();
    runWithRequestContext(ctxOf('u1', [ws]), () => {
      const ctx = currentRequestContext();
      expect(() => {
        (ctx as { role: string }).role = 'owner';
      }).toThrow(TypeError);
      expect(() => (ctx.workspaceIds as string[]).push(randomUUID())).toThrow(TypeError);
      expect(ctx.workspaceIds).toEqual([ws]);
    });
  });

  it('does not keep a reference to the caller array', () => {
    const list = [randomUUID()];
    runWithRequestContext(ctxOf('u1', list), () => {
      list.push(randomUUID());
      expect(currentRequestContext().workspaceIds).toHaveLength(1);
    });
  });

  it('lets a nested call replace the context for its own scope only', () => {
    runWithRequestContext(ctxOf('outer'), () => {
      runWithRequestContext(ctxOf('inner'), () => {
        expect(currentRequestContext().userId).toBe('inner');
      });
      expect(currentRequestContext().userId).toBe('outer');
    });
  });
});

// A leak of the context between requests is a security incident (an answer for person A sent to person B), so this goes through
// a real HTTP server with many requests in flight, every kind of async hop, and some requests that never get a context.
describe('isolation between concurrent requests', () => {
  const COUNT = 50;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? '';
      const seen: string[] = [];
      const look = () => {
        try {
          seen.push(currentRequestContext().userId);
        } catch (error) {
          seen.push(error instanceof RequestContextMissingError ? 'MISSING' : 'OTHER');
        }
      };
      const work = async () => {
        look();
        await sleep(randomInt(0, 25));
        look();
        await new Promise<void>((done) => setImmediate(done));
        look();
        await new Promise<void>((done) => process.nextTick(done));
        await Promise.all([sleep(randomInt(0, 10)).then(look), Promise.resolve().then(look)]);
        await new Promise<void>((done) => {
          setTimeout(
            () => {
              look();
              done();
            },
            randomInt(0, 10),
          );
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id, seen }));
      };
      // Every third request skips the middleware: it must see nothing, not a neighbour's context.
      if (Number(id) % 3 === 0) void work();
      else void runWithRequestContext(ctxOf(id), work);
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });

  it(`gives each of ${COUNT} interleaved requests its own context at every await`, async () => {
    const answers = await Promise.all(
      Array.from({ length: COUNT }, async (_, i) => {
        await sleep(randomInt(0, 15));
        const res = await fetch(`${base}/?id=${i + 1}`);
        return (await res.json()) as { id: string; seen: string[] };
      }),
    );
    expect(answers).toHaveLength(COUNT);
    for (const { id, seen } of answers) {
      const expected = Number(id) % 3 === 0 ? 'MISSING' : id;
      expect(seen.length).toBeGreaterThanOrEqual(6);
      expect(new Set(seen), `request ${id}`).toEqual(new Set([expected]));
    }
    expect(() => currentRequestContext()).toThrow(RequestContextMissingError);
  });
});
