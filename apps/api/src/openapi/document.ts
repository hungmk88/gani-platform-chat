import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { registerConversations } from '../modules/conversations/conversations.openapi.js';
import { problemResponse as problem } from './schemas.js';

// The contract the front end builds on (Brief P18): generated from the Zod schemas the API validates with, so the two cannot drift.
// docs/openapi/openapi.json is this document as committed; document.test.ts fails when they differ (run `pnpm --filter @gani/api
// openapi` after changing an endpoint). Each module adds its paths through a register function listed in REGISTER below.

function registerPlatform(registry: OpenAPIRegistry): void {
  const status = (values: [string, ...string[]]) => z.object({ status: z.enum(values) });
  registry.registerPath({
    method: 'get',
    path: '/healthz',
    summary: 'Liveness: the process is up (touches no dependency).',
    tags: ['platform'],
    responses: {
      200: { description: 'Alive.', content: { 'application/json': { schema: status(['ok']) } } },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/readyz',
    summary: 'Readiness: both databases answer. No reason is given when they do not.',
    tags: ['platform'],
    responses: {
      200: { description: 'Ready.', content: { 'application/json': { schema: status(['ok']) } } },
      503: {
        description: 'Not ready.',
        content: { 'application/json': { schema: status(['unavailable']) } },
      },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/me/security-status',
    summary:
      'Whether a second factor is required of the signed-in person, on, and must be set up now (N89).',
    tags: ['me'],
    responses: {
      200: {
        description: 'The 2FA status.',
        content: {
          'application/json': {
            schema: z
              .object({
                twoFactorEnabled: z.boolean(),
                required: z.boolean(),
                mustSetUp: z.boolean(),
              })
              .meta({ id: 'SecurityStatus' }),
          },
        },
      },
      401: problem('unauthorized: no valid session.'),
    },
  });
}

const REGISTER: readonly ((registry: OpenAPIRegistry) => void)[] = [
  registerPlatform,
  registerConversations,
];

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  for (const register of REGISTER) register(registry);
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Gani Platform API',
      version: '0.1.0',
      description:
        'Brief Backend & Core v1.0, P9. Session cookie of Better Auth (/api/auth/*); the organisation and workspaces come from the session, never from a request. Errors are RFC 9457 with a snake_case `code` (N132).',
    },
  });
}

/** The committed form: two-space JSON and a final newline, so a diff of docs/openapi/openapi.json reads line by line. */
export const serialiseOpenApi = (document: unknown): string =>
  `${JSON.stringify(document, null, 2)}\n`;
