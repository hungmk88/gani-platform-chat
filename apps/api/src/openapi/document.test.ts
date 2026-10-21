import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, serialiseOpenApi } from './document.js';

const committed = (): string =>
  readFileSync(new URL('../../../../docs/openapi/openapi.json', import.meta.url), 'utf8');

describe('the OpenAPI document (Brief P18)', () => {
  it('is the one committed in docs/openapi/openapi.json: run `pnpm --filter @gani/api build && pnpm --filter @gani/api openapi` after changing an endpoint', () => {
    expect(committed()).toBe(serialiseOpenApi(buildOpenApiDocument()));
  });

  it('is OpenAPI 3.1 with the shared Problem schema and the routes the API serves', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Problem', 'SecurityStatus']),
    );
    expect(Object.keys(doc.paths ?? {})).toEqual([
      '/healthz',
      '/readyz',
      '/v1/me/security-status',
      '/v1/conversations',
      '/v1/conversations/{id}',
      '/v1/conversations/{id}/messages',
      '/v1/conversations/{id}/claim',
      '/v1/conversations/{id}/wait-customer',
      '/v1/conversations/{id}/transfer',
      '/v1/conversations/{id}/assign',
      '/v1/conversations/{id}/close',
    ]);
  });
});
