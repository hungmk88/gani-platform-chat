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

// U61 (Brief P9 "GET/PATCH /v1/workspaces/{id}/ai-settings", Brief §599, Phụ lục B dòng 41; anh duyệt 31/10/2026): the internal AI
// of a workspace. Who changes what: an Owner or an Admin turns E1/L1 on or off and sets the budget; only an Owner moves the
// environment to `production` (an Admin gets 403). Q1 (legal) is not settled: the API refuses `production` with 409
// `ai_production_locked`, and may open it once Q1 is.

export const AI_ENVIRONMENTS = ['staging', 'production'] as const;

export const AiFeaturesSchema = z
  .object({
    /** E1: intent and details of a message (product, quantity, area, phone), internal only. */
    e1: z.boolean(),
    /** L1: one-click summary of a conversation, internal only. */
    l1: z.boolean(),
  })
  .meta({ id: 'AiFeatures' });

export const AiSettingsSchema = z
  .object({
    environment: z.enum(AI_ENVIRONMENTS),
    features: AiFeaturesSchema,
    monthlyBudgetUsd: z.number().min(0).meta({
      description:
        'The budget of one calendar month in the time zone of the workspace (`workspace.timezone`), in USD. BudgetGuard warns at 80% and stops at 100% (`ai_budget_exceeded`, back to the scripted flow).',
    }),
    usedThisMonthUsd: z.number().min(0).meta({
      description: 'Spent since the month began in `workspace.timezone` (ai_usage_logs).',
    }),
    resetsAt: z.iso.datetime().meta({
      description:
        'When the next month begins in `workspace.timezone`, and the spending starts again at 0.',
    }),
  })
  .meta({ id: 'AiSettings' });

/** PATCH: only what changes; an empty body is a 400. */
export const AiSettingsChangeSchema = z
  .object({
    environment: z.enum(AI_ENVIRONMENTS).optional(),
    features: AiFeaturesSchema.partial().strict().optional(),
    monthlyBudgetUsd: z.number().min(0).max(1_000_000).optional(),
  })
  .strict()
  .meta({ id: 'AiSettingsChange' });
