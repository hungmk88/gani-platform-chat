// Writes docs/openapi/openapi.json from the BUILT API (`pnpm --filter @gani/api build` first): the document the Zod schemas of the
// endpoints describe (Brief P18). Run it after changing an endpoint and commit the file; document.test.ts fails while they differ.
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { buildOpenApiDocument, serialiseOpenApi } from '../dist/openapi/document.js';

const target = fileURLToPath(new URL('../../../docs/openapi/openapi.json', import.meta.url));
writeFileSync(target, serialiseOpenApi(buildOpenApiDocument()));
console.log(`wrote ${target}`);
