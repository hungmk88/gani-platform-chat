import type pg from 'pg';

// The organisations whose SLA clock the opening hours move (E4b, N211), for the job that pauses a running SLA `outside_hours` when a
// workspace closes and runs it again when it opens. Asked outside any tenant through a SECURITY DEFINER function that hands back ids
// only; the job then reads each organisation through RLS.

/** The organisations with a running SLA or one paused `outside_hours`, by id, through `app.sla_running_orgs` (1..1000). */
export async function slaRunningOrgs(pool: pg.Pool, limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.sla_running_orgs($1)',
    [limit],
  );
  return rows.map((r) => r.org_id);
}
