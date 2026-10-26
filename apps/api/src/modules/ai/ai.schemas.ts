import { z } from 'zod';

// E20, the prompts of the AI read-only (#26; U35, CEO 26/10/2026). Prompts live in prompts/<template>/<task>@<semver> and
// prompt_versions (Brief §7); a change goes through the test suite and a review, never through a screen.

export const PromptVersionSchema = z
  .object({
    /** `<template>/<task>`, e.g. `b2b/answer`. */
    key: z.string(),
    /** Semantic version of the file (`1.0.0`). */
    version: z.string(),
    /** Whether this version is the one in use now. */
    active: z.boolean(),
    approvedAt: z.iso.datetime().nullable(),
    /** The name of who approved it; null when not yet approved. */
    approvedBy: z.string().nullable(),
  })
  .meta({ id: 'PromptVersion' });

export const PromptVersionListSchema = z
  .object({ data: z.array(PromptVersionSchema) })
  .meta({ id: 'PromptVersionList' });
