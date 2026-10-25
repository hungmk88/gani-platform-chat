import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { orgMembers } from '@gani/db';
import { z } from 'zod';

import { registerChannels } from '../modules/channels/channels.openapi.js';
import { registerConversations } from '../modules/conversations/conversations.openapi.js';
import { registerMembers } from '../modules/members/members.openapi.js';
import { MeChangeSchema } from '../modules/request-context/me.schemas.js';
import { registerTeams } from '../modules/teams/teams.openapi.js';
import { registerWorkspaces } from '../modules/workspaces/workspaces.openapi.js';
import { problemResponse as problem, UuidSchema } from './schemas.js';

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
  const named = z.object({ id: UuidSchema, name: z.string() });
  const me = z
    .object({
      id: UuidSchema,
      name: z.string(),
      isPlatformOperator: z.boolean(),
      org: named
        .extend({ role: z.enum(orgMembers.role.enumValues) })
        .nullable()
        .meta({ id: 'MeOrg' }),
      workspaces: z.array(named.meta({ id: 'MeWorkspace' })),
    })
    .meta({ id: 'Me' });
  const meAnswer = {
    description:
      '`org` is null for a person of no organisation, or of several with none chosen (the other /v1 routes answer 403 then). `name` falls back to the email.',
    content: { 'application/json': { schema: me } },
  };
  const refusals = {
    401: problem('unauthorized: no valid session.'),
    403: problem('two_factor_setup_required: the second factor must be set up first (N93).'),
    503: problem('service_unavailable: a database did not answer.'),
  };
  registry.registerPath({
    method: 'get',
    path: '/v1/me',
    summary:
      'The signed-in person, the organisation they act in and its workspaces they belong to (U32, N145). Ask security-status first.',
    tags: ['me'],
    responses: { 200: meAnswer, ...refusals },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/me',
    summary: 'Change the name the signed-in person goes by (N162). Answers as GET /v1/me.',
    tags: ['me'],
    request: { body: { content: { 'application/json': { schema: MeChangeSchema } } } },
    responses: {
      200: meAnswer,
      400: problem(
        'validation_failed: the name (1–100 characters once trimmed) or an unknown field.',
      ),
      ...refusals,
      403: problem(
        'two_factor_setup_required: the second factor must be set up first (N93); or forbidden: the request did not come from the application (N136).',
      ),
    },
  });
}

const REGISTER: readonly ((registry: OpenAPIRegistry) => void)[] = [
  registerPlatform,
  registerConversations,
  registerMembers,
  registerWorkspaces,
  registerTeams,
  registerChannels,
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
