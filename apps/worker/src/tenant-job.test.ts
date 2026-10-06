import { InvalidTenantContextError, currentTenantContext } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { JobTenantMissingError, runForJob, tenantOfJob } from './tenant-job.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const WS = '0197a3c0-0000-7000-8000-000000000002';

describe('tenantOfJob', () => {
  it('names the organisation, and the workspace when the job has one', () => {
    expect(tenantOfJob({ orgId: ORG })).toEqual({ orgId: ORG, workspaceIds: [] });
    expect(tenantOfJob({ orgId: ORG, workspaceId: null })).toEqual({
      orgId: ORG,
      workspaceIds: [],
    });
    expect(tenantOfJob({ orgId: ORG, workspaceId: WS, other: 'ignored' })).toEqual({
      orgId: ORG,
      workspaceIds: [WS],
    });
  });

  it.each([undefined, null, '', 7, {}, ['x']])('refuses a job whose orgId is %j', (orgId) => {
    expect(() => tenantOfJob({ orgId })).toThrowError(JobTenantMissingError);
  });

  it('refuses a workspaceId that is not text', () => {
    expect(() => tenantOfJob({ orgId: ORG, workspaceId: 7 })).toThrowError(JobTenantMissingError);
  });
});

describe('runForJob: a job without a tenant fails at once, before any query', () => {
  it.each([{}, { workspaceId: WS }, { orgId: '' }, { orgId: 42 }])(
    'runs nothing for %j',
    async (payload) => {
      const query = vi.fn(() => Promise.resolve());
      await expect(runForJob(payload, query)).rejects.toThrowError(JobTenantMissingError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([{ orgId: 'not-a-uuid' }, { orgId: ORG, workspaceId: 'nope' }])(
    'runs nothing for %j either (not a UUID)',
    async (payload) => {
      const query = vi.fn(() => Promise.resolve());
      await expect(runForJob(payload, query)).rejects.toThrowError(InvalidTenantContextError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('runs fn once for a valid job, with the tenant of the payload as the current one', async () => {
    const seen = await runForJob({ orgId: ORG, workspaceId: WS }, (tenant) =>
      Promise.resolve([tenant, currentTenantContext()]),
    );
    expect(seen[0]).toEqual({ orgId: ORG, workspaceIds: [WS] });
    expect(seen[1]).toEqual(seen[0]);
  });
});
