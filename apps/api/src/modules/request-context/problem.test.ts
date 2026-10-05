import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { PROBLEM_CONTENT_TYPE, problem, sendProblem } from './problem.js';

describe('problem', () => {
  it('builds an RFC 9457 body with the reason phrase as title', () => {
    expect(problem(403, 'ORG_NOT_SELECTED')).toEqual({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'ORG_NOT_SELECTED',
    });
    expect(problem(401, 'UNAUTHENTICATED', 'Sign in first').detail).toBe('Sign in first');
  });

  it('is sent as application/problem+json with the status of the problem and no caching', async () => {
    const server = createServer((_req, res) => sendProblem(res, problem(404, 'NOT_FOUND')));
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(problem(404, 'NOT_FOUND'));
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
});
