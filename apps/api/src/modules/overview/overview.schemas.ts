import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// #16 Tổng quan (U28/U29, CEO 26/10/2026): the five cards of Đợt 1. CSAT and the AI figures wait for Đợt 2.

export const OverviewQuerySchema = z.object({ workspaceId: UuidSchema }).strict();

export const OverviewSchema = z
  .object({
    /** `workspace`: the whole workspace (Owner, Admin, Manager, Marketing, Viewer); `me`: what I hold (Sales, Support: "Mình"). */
    scope: z.enum(['workspace', 'me']),
    /** Conversations not closed. */
    openConversations: z.int().min(0),
    /** Waiting for an agent to claim them (HUMAN_WAITING_Q). */
    waitingForAgent: z.int().min(0),
    /** 90th percentile of the time to the first reply of an agent, for conversations started today (time zone of the workspace). */
    firstResponseP90Seconds: z.number().min(0).nullable(),
    /** Open conversations past their SLA; null until SLA exists (Q7). */
    overSla: z.int().min(0).nullable(),
    /** Agents whose status is Online (C10, 3 levels), and all who hold conversations; null for scope `me`. */
    agentsOnline: z.int().min(0).nullable(),
    agentsTotal: z.int().min(0).nullable(),
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Overview' });
