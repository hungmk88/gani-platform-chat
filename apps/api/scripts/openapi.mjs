// Writes docs/openapi/openapi.json from the BUILT API (`pnpm --filter @gani/api build` first): the document the Zod schemas of the
// endpoints describe (Brief P18). Run it after changing an endpoint and commit the file; document.test.ts fails while they differ.
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { buildOpenApiDocument, serialiseOpenApi } from '../dist/openapi/document.js';
import { buildPlannedDocument } from '../dist/openapi/planned.js';

// openapi.json: what the API serves. planned.json: the contract of what is not built yet (N167).
for (const [name, build] of [
  ['openapi.json', buildOpenApiDocument],
  ['planned.json', buildPlannedDocument],
]) {
  const target = fileURLToPath(new URL(`../../../docs/openapi/${name}`, import.meta.url));
  writeFileSync(target, serialiseOpenApi(build()));
  console.log(`wrote ${target}`);
}
