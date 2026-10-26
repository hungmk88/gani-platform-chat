import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, serialiseOpenApi } from './document.js';
import { buildPlannedDocument } from './planned.js';

const committed = (name = 'openapi.json'): string =>
  readFileSync(new URL(`../../../../docs/openapi/${name}`, import.meta.url), 'utf8');

describe('the OpenAPI document (Brief P18)', () => {
  it('is the one committed in docs/openapi/openapi.json: run `pnpm --filter @gani/api build && pnpm --filter @gani/api openapi` after changing an endpoint', () => {
    expect(committed()).toBe(serialiseOpenApi(buildOpenApiDocument()));
  });

  it('describes no field with allOf (U34): a nullable id is `type: [string, null]` + `format: uuid`, so the generated type keeps null', () => {
    expect(serialiseOpenApi(buildOpenApiDocument())).not.toContain('"allOf"');
  });

  it('is OpenAPI 3.1 with the shared Problem schema and the routes the API serves', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Problem', 'SecurityStatus', 'Me']),
    );
    expect(Object.keys(doc.paths ?? {})).toEqual([
      '/healthz',
      '/readyz',
      '/v1/me/security-status',
      '/v1/me',
      '/v1/conversations',
      '/v1/conversations/{id}',
      '/v1/conversations/{id}/messages',
      '/v1/conversations/{id}/claim',
      '/v1/conversations/{id}/wait-customer',
      '/v1/conversations/{id}/transfer',
      '/v1/conversations/{id}/assign',
      '/v1/conversations/{id}/close',
      '/v1/members',
      '/v1/members/{id}/role',
      '/v1/members/{id}/capacity',
      '/v1/members/{id}/2fa/reset',
      '/v1/members/invite',
      '/v1/members/{id}/resend-invite',
      '/v1/workspaces',
      '/v1/workspaces/{id}',
      '/v1/workspaces/{id}/members',
      '/v1/teams',
      '/v1/teams/{id}',
      '/v1/teams/{id}/members',
      '/v1/teams/{id}/channels',
      '/v1/channels',
      '/v1/quick-replies',
      '/v1/quick-replies/{id}',
      '/v1/quick-replies/{id}/used',
      '/v1/quick-replies/{id}/preview',
      '/v1/quick-replies/preview',
      '/v1/customers',
      '/v1/customers/{id}',
    ]);
  });
});

describe('the planned document (N167)', () => {
  it('is the one committed in docs/openapi/planned.json: run `pnpm --filter @gani/api openapi` after changing a planned path', () => {
    expect(committed('planned.json')).toBe(serialiseOpenApi(buildPlannedDocument()));
  });

  it('marks every operation planned with its sprint, uses no allOf, and shares no path with what is served', () => {
    const doc = buildPlannedDocument();
    const operations = Object.values(doc.paths ?? {}).flatMap((item) =>
      Object.values(item as Record<string, Record<string, unknown>>),
    );
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations)
      expect([op['x-status'], typeof op['x-sprint']]).toEqual(['planned', 'string']);
    expect(serialiseOpenApi(doc)).not.toContain('"allOf"');
    const served = new Set(Object.keys(buildOpenApiDocument().paths ?? {}));
    expect(Object.keys(doc.paths ?? {}).filter((path) => served.has(path))).toEqual([]);
  });
});
