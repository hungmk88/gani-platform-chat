import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { registerAutonomy } from '../modules/autonomy/autonomy.openapi.js';
import { registerFeatureFlags } from '../modules/feature-flags/feature-flags.openapi.js';
import { registerOverview } from '../modules/overview/overview.openapi.js';
import { registerTickets } from '../modules/tickets/tickets.openapi.js';

// The contract of what is not built yet (N167): the paths the CEO's decisions of 26/10/2026 settled (U27, U28, U29, U35), so the front
// end can build #14/#15, #16, #27, #11, #29 now. Same tools and shared schemas as document.ts, written to docs/openapi/planned.json.
// When an endpoint is built, its register call moves to REGISTER of document.ts: document.test.ts fails while a path is in both.

const REGISTER_PLANNED: readonly ((registry: OpenAPIRegistry) => void)[] = [
  registerTickets,
  registerOverview,
  registerFeatureFlags,
  registerAutonomy,
];

export function buildPlannedDocument() {
  const registry = new OpenAPIRegistry();
  for (const register of REGISTER_PLANNED) register(registry);
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Gani Platform API — planned',
      version: '0.1.0-planned',
      description:
        'Paths NOT served yet (`x-status: planned`, `x-sprint`): the contract the front end builds on until each moves to openapi.json. Same rules as openapi.json: session cookie, organisation from the session, RFC 9457 errors with a snake_case `code`.',
    },
  });
}
