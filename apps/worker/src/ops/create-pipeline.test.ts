import { describe, expect, it } from 'vitest';

import type { Queryable } from './create-org.js';
import {
  CreatePipelineRefusedError,
  createPipelines,
  readCreatePipelineArgs,
} from './create-pipeline.js';

const env = { APP_ENV: 'production' };
const reason = (argv: string[], e: Record<string, string | undefined> = env) => {
  try {
    readCreatePipelineArgs(argv, e);
    return 'accepted';
  } catch (error) {
    return error instanceof CreatePipelineRefusedError ? error.reason : error;
  }
};

describe('readCreatePipelineArgs (N200 answer 3)', () => {
  it('reads one workspace or --all, and the operator in lower case', () => {
    const base = ['--org', 'gani-foods', '--operator', ' Ops@Example.TEST '];
    expect(readCreatePipelineArgs([...base, '--workspace', 'b2b'], env)).toEqual({
      org: 'gani-foods',
      workspace: 'b2b',
      operatorEmail: 'ops@example.test',
    });
    expect(readCreatePipelineArgs([...base, '--all'], env)).toMatchObject({ workspace: null });
  });

  it('refuses no APP_ENV, a bad org, neither or both of --workspace and --all, a bad slug and a bad email', () => {
    const ok = ['--org', 'gani-foods', '--operator', 'ops@example.test'];
    expect([
      reason([...ok, '--all'], {}),
      reason(['--org', 'Gani Foods', '--operator', 'ops@example.test', '--all']),
      reason(ok),
      reason([...ok, '--all', '--workspace', 'b2b']),
      reason([...ok, '--workspace', 'B2B!']),
      reason(['--org', 'gani-foods', '--operator', 'ops', '--all']),
    ]).toEqual([
      'app_env_missing',
      'org_invalid',
      'workspace_invalid',
      'workspace_invalid',
      'workspace_invalid',
      'email_invalid',
    ]);
  });
});

/** A client over a tiny in-memory database: the workspaces of one org, which of them have steps or reasons, and what was written. */
function fakeDb(state: {
  operator?: boolean;
  org?: boolean;
  workspaces: { id: string; slug: string }[];
  withStages?: string[];
  withReasons?: string[];
}) {
  const written: { sql: string; params: unknown[] }[] = [];
  const stages = new Set(state.withStages ?? []);
  const reasons = new Set(state.withReasons ?? []);
  const rows = <R>(r: R[]) => ({ rows: r, rowCount: r.length });
  const client: Queryable = {
    query: <R extends object>(sql: string, params: unknown[] = []) => {
      const out = (r: object[]) => Promise.resolve(rows(r as R[]));
      if (sql.includes('FROM public.users'))
        return out(state.operator === false ? [] : [{ id: 'op' }]);
      if (sql.includes('FROM public.organizations'))
        return out(state.org === false ? [] : [{ id: 'org' }]);
      if (sql.includes('FROM public.workspaces'))
        return out(state.workspaces.filter((w) => params[1] === null || w.slug === params[1]));
      if (sql.includes('FROM public.pipeline_stages'))
        return out(stages.has(String(params[1])) ? [{}] : []);
      if (sql.includes('FROM public.pipeline_lost_reasons'))
        return out(reasons.has(String(params[1])) ? [{}] : []);
      written.push({ sql, params });
      if (sql.includes('INTO public.pipeline_stages')) stages.add(String(params[2]));
      if (sql.includes('INTO public.pipeline_lost_reasons')) reasons.add(String(params[2]));
      return out([]);
    },
  };
  return { client, written };
}
let n = 0;
const newId = () => `id-${++n}`;
const input = (workspace: string | null) => ({
  org: 'gani-foods',
  workspace,
  operatorEmail: 'ops@example.test',
});

describe('createPipelines', () => {
  const workspaces = [
    { id: 'w1', slug: 'b2b' },
    { id: 'w2', slug: 'b2c' },
    { id: 'w3', slug: 'service' },
  ];

  it('gives the pipeline to the workspaces that lack it, audits each, logs the access once, and adds nothing on a second run', async () => {
    const { client, written } = fakeDb({
      workspaces,
      withStages: ['w2'],
      withReasons: ['w2', 'w3'],
    });
    expect(await createPipelines(client, input(null), newId)).toEqual({
      orgId: 'org',
      created: ['w1', 'w3'],
      skipped: 1,
    });
    const audits = written
      .filter((w) => w.sql.includes('audit_logs'))
      .map((w) => [w.params[3], w.params[4]]);
    expect(audits).toEqual([
      ['w1', { stages: 6, reasons: 1, via: 'tenant:create-pipeline' }],
      ['w3', { stages: 6, reasons: 0, via: 'tenant:create-pipeline' }],
    ]);
    expect(written.filter((w) => w.sql.includes('platform_access_logs'))).toHaveLength(1);
    const before = written.length;
    expect(await createPipelines(client, input(null), newId)).toEqual({
      orgId: 'org',
      created: [],
      skipped: 3,
    });
    expect(written.slice(before).map((w) => w.sql.includes('platform_access_logs'))).toEqual([
      true,
    ]);
  });

  it('takes one workspace by its slug, and refuses an unknown one, an unknown org or someone who is not an operator', async () => {
    expect(
      (await createPipelines(fakeDb({ workspaces }).client, input('b2c'), newId)).created,
    ).toEqual(['w2']);
    const refused = async (state: Parameters<typeof fakeDb>[0], workspace: string | null) => {
      const { client, written } = fakeDb(state);
      const error: unknown = await createPipelines(client, input(workspace), newId).catch(
        (e: unknown) => e,
      );
      return [error instanceof CreatePipelineRefusedError ? error.reason : error, written.length];
    };
    expect(await refused({ workspaces }, 'nope')).toEqual(['workspace_unknown', 0]);
    expect(await refused({ workspaces, org: false }, null)).toEqual(['org_unknown', 0]);
    expect(await refused({ workspaces, operator: false }, null)).toEqual(['operator_unknown', 0]);
  });
});
