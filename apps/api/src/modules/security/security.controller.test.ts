import { randomUUID } from 'node:crypto';

import { InvalidCursorError, listSecurityAlerts } from '@gani/db';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ValidationFailedError } from '../../openapi/zod-pipe.js';
import type { DatabaseService } from '../database/database.service.js';
import { runWithRequestContext } from '../request-context/request-context.js';
import { SecurityController } from './security.controller.js';

vi.mock('@gani/db', async (actual) => ({
  ...(await actual<typeof import('@gani/db')>()),
  listSecurityAlerts: vi.fn(),
}));

// The controller without a database (P11b-2a): who may read, the transaction it opens, and how a row is answered. Over HTTP on
// PostgreSQL: security.integration.test.ts.
const [ORG, ME] = [randomUUID(), randomUUID()];
const withTenant = vi.fn((_ctx: unknown, fn: (tx: never) => unknown) => fn({} as never));
const controller = new SecurityController({ withTenant } as unknown as DatabaseService);
const base = {
  userId: ME,
  orgId: ORG,
  workspaceIds: [randomUUID()],
  resolvedAt: new Date(),
  traceId: 't',
};
const as = <T>(role: string, fn: () => T) =>
  runWithRequestContext(
    (role === 'platform_operator'
      ? { ...base, role, accessSessionId: randomUUID() }
      : { ...base, role }) as never,
    fn,
  );
const at = new Date('2026-11-08T08:00:00Z');

describe('SecurityController', () => {
  it('lets an Owner, an Admin and an operator read, in the organisation with no workspace; refuses the rest before reading', async () => {
    vi.mocked(listSecurityAlerts).mockResolvedValue({ rows: [], nextCursor: null });
    for (const role of ['owner', 'admin', 'platform_operator'])
      await as(role, () => controller.alerts({ limit: 5, open: 'false' }));
    expect(withTenant).toHaveBeenCalledWith({ orgId: ORG, workspaceIds: [] }, expect.any(Function));
    expect(listSecurityAlerts).toHaveBeenLastCalledWith({}, { limit: 5, open: false });
    withTenant.mockClear();
    for (const role of ['manager', 'sales', 'marketing', 'viewer', 'support'])
      await expect(as(role, () => controller.alerts({ limit: 5 }))).rejects.toThrow(
        ForbiddenException,
      );
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('answers an alert as ids and codes, with every filter passed on', async () => {
    const alert = {
      id: 'a',
      kind: 'login_failures',
      severity: 'high',
      subjectUserId: ME,
      channelAccountId: null,
    };
    vi.mocked(listSecurityAlerts).mockResolvedValue({
      rows: [{ ...alert, occurredAt: at, count: 2, incidentId: null }] as never,
      nextCursor: 'n',
    });
    const q = { limit: 1, severity: 'high', cursor: 'c', open: 'true' } as const;
    expect(await as('owner', () => controller.alerts(q))).toEqual({
      data: [{ ...alert, occurredAt: at.toISOString(), count: 2, incidentId: null }],
      nextCursor: 'n',
    });
    expect(listSecurityAlerts).toHaveBeenLastCalledWith({}, { ...q, open: true });
  });

  it('answers a bad cursor as 400 and lets any other failure through', async () => {
    vi.mocked(listSecurityAlerts).mockRejectedValueOnce(new InvalidCursorError());
    await expect(as('owner', () => controller.alerts({ limit: 1, cursor: 'x' }))).rejects.toThrow(
      ValidationFailedError,
    );
    vi.mocked(listSecurityAlerts).mockRejectedValueOnce(new Error('down'));
    await expect(as('owner', () => controller.alerts({ limit: 1 }))).rejects.toThrow('down');
  });
});
