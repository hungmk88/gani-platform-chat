import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The status of an agent (U82, U85; C10, D4; CEO 05/11/2026): the contract given to the front end before the module is built (S4,
// planned.ts). The table of statuses and its history come with the code (S4); the time without a socket after which an agent goes
// offline (10 minutes) waits for Q7.

const at = z.iso.datetime();

/** `busy`: holds no new conversation. `offline`: set by the person, or by the API once their sockets are gone (`disconnected`). */
export const AGENT_STATUSES = ['online', 'busy', 'offline'] as const;

export const AgentStatusSchema = z
  .object({
    status: z.enum(AGENT_STATUSES),
    /** When this status began. */
    since: at,
    /** `manual`: the person chose it; `disconnected`: the API set `offline` when their sockets were gone (Q7); null: never changed. */
    reason: z.enum(['manual', 'disconnected']).nullable(),
  })
  .meta({ id: 'AgentStatus' });

/** What the person sets: always `reason: manual`. Nobody sets another person's status in Đợt 1 (U43, Đợt 2). */
export const AgentStatusChangeSchema = z
  .object({ status: z.enum(AGENT_STATUSES) })
  .strict()
  .meta({ id: 'AgentStatusChange' });

export const TeamAgentStatusSchema = z
  .object({
    userId: UuidSchema,
    /** null when the person gave none or is no longer an active member. */
    name: z.string().nullable(),
    status: z.enum(AGENT_STATUSES),
    since: at,
    /** Minutes in `busy` since 00:00 today in the time zone of the team's workspace (U42). */
    busyMinutesToday: z.int().min(0),
  })
  .meta({ id: 'TeamAgentStatus' });

/** The members of the team who hold conversations, by name. */
export const TeamAgentStatusListSchema = z
  .object({ data: z.array(TeamAgentStatusSchema) })
  .meta({ id: 'TeamAgentStatusList' });
