import { and, desc, eq, getTableColumns, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { Page } from './conversation-read.js';
import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { orgMembers } from './schema/org-members.js';
import { securityAlerts as a, securityIncidents as i } from './schema/security.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The security alerts and incidents of an organisation (P11a-2, N207; tables of P11a-1). Row-level security keeps them to the
// organisation of the tenant; who may read or write (Owner, Admin, a platform operator inside an access session) is the API's check.
// Ids and codes only: the title of an incident is the opener's words, never logged. An incident is closed once; it is never deleted.

export type SecuritySeverity = (typeof i.$inferSelect)['severity'];

/** An alert as stored; its kind and subject are codes and ids only. */
export type SecurityAlertRow = typeof a.$inferSelect;
/** An incident, with the alerts it covers (oldest first); opened by a member or by a platform operator, exactly one of the two. */
export type SecurityIncidentRow = typeof i.$inferSelect & { readonly alertIds: readonly string[] };

const failure = (name: string, message: string) =>
  class extends Error {
    constructor() {
      super(message);
      this.name = name;
    }
  };
/** The handler is not an active Owner or Admin of the organisation (422 `invalid_handler`). */
export class InvalidIncidentHandlerError extends failure(
  'InvalidIncidentHandlerError',
  'not an active Owner or Admin',
) {}
/** An alert is not of the organisation, or another incident covers it already (422 `invalid_alert`). */
export class InvalidIncidentAlertError extends failure(
  'InvalidIncidentAlertError',
  'an alert not of the organisation or covered',
) {}
/** The incident is closed: it stays closed (409 `incident_closed`). */
export class SecurityIncidentClosedError extends failure(
  'SecurityIncidentClosedError',
  'the incident is closed',
) {}

/** At most this many a page (P9). */
export const SECURITY_PAGE_MAX = 100;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const incidentColumns = {
  ...getTableColumns(i),
  // Qualified by hand: Drizzle writes a column of a one-table select without its table, and inside the subquery `id` would be s.id.
  alertIds: sql<
    string[]
  >`coalesce((SELECT array_agg(s.id ORDER BY s.id) FROM public.security_alerts s WHERE s.org_id = public.security_incidents.org_id AND s.incident_id = public.security_incidents.id), '{}')`,
};

function paging(
  q: { readonly cursor?: string; readonly limit: number },
  id: typeof a.id | typeof i.id,
) {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > SECURITY_PAGE_MAX)
    throw new RangeError(`limit must be 1..${SECURITY_PAGE_MAX}`);
  return q.cursor === undefined
    ? []
    : [lt(id, cursorString(decodeCursor(q.cursor), 'id', UUID_FORMAT))];
}

function page<T extends { readonly id: string }>(rows: T[], limit: number): Page<T> {
  const rowsOfPage = rows.slice(0, limit);
  const last = rowsOfPage.at(-1);
  return {
    rows: rowsOfPage,
    nextCursor: rows.length > limit && last ? encodeCursor({ id: last.id }) : null,
  };
}

/** The alerts of the organisation, newest first; `open`: only those no incident covers yet. */
export async function listSecurityAlerts(
  tx: TenantTx,
  q: {
    readonly severity?: SecuritySeverity;
    readonly open?: boolean;
    readonly cursor?: string;
    readonly limit: number;
  },
): Promise<Page<SecurityAlertRow>> {
  const where = paging(q, a.id);
  if (q.severity !== undefined) where.push(eq(a.severity, q.severity));
  if (q.open === true) where.push(isNull(a.incidentId));
  if (q.open === false) where.push(sql`${a.incidentId} IS NOT NULL`);
  const rows = await tx
    .select()
    .from(a)
    .where(and(...where))
    .orderBy(desc(a.id))
    .limit(q.limit + 1);
  return page(rows as SecurityAlertRow[], q.limit);
}

/** The incidents of the organisation, newest first, with the ids of the alerts each covers. */
export async function listSecurityIncidents(
  tx: TenantTx,
  q: { readonly status?: 'open' | 'closed'; readonly cursor?: string; readonly limit: number },
): Promise<Page<SecurityIncidentRow>> {
  const where = paging(q, i.id);
  if (q.status !== undefined) where.push(eq(i.status, q.status));
  const rows = await tx
    .select(incidentColumns)
    .from(i)
    .where(and(...where))
    .orderBy(desc(i.id))
    .limit(q.limit + 1);
  return page(rows as SecurityIncidentRow[], q.limit);
}

/** One incident of the organisation, or null. */
export async function loadSecurityIncident(
  tx: TenantTx,
  id: string,
): Promise<SecurityIncidentRow | null> {
  const [row] = await tx
    .select(incidentColumns)
    .from(i)
    .where(eq(i.id, assertUuid(id, 'id')));
  return (row as SecurityIncidentRow | undefined) ?? null;
}

async function assertHandler(tx: TenantTx, userId: string): Promise<string> {
  const [member] = await tx
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.userId, assertUuid(userId, 'handlerUserId')),
        inArray(orgMembers.role, ['owner', 'admin']),
        eq(orgMembers.status, 'active'),
        isNull(orgMembers.deletedAt),
      ),
    );
  if (!member) throw new InvalidIncidentHandlerError();
  return userId;
}

/**
 * Opens an incident and has it cover `alertIds`: each must be of the organisation and covered by no incident yet, else nothing is
 * written. The alerts are locked first, so two incidents opened at once cannot take the same alert.
 */
export async function openSecurityIncident(
  tx: TenantTx,
  incident: {
    readonly id: string;
    readonly title: string;
    readonly severity: SecuritySeverity;
    readonly handlerUserId: string;
    readonly openedBy: { readonly userId: string } | { readonly operatorId: string };
    readonly alertIds: readonly string[];
  },
): Promise<SecurityIncidentRow> {
  const id = assertUuid(incident.id, 'id');
  const handlerUserId = await assertHandler(tx, incident.handlerUserId);
  const alertIds = [...new Set(incident.alertIds.map((alert) => assertUuid(alert, 'alertIds')))];
  if (alertIds.length > 0) {
    const free = await tx
      .select({ id: a.id })
      .from(a)
      .where(and(inArray(a.id, alertIds), isNull(a.incidentId)))
      .for('update');
    if (free.length !== alertIds.length) throw new InvalidIncidentAlertError();
  }
  await tx.insert(i).values({
    id,
    orgId: currentTenantContext().orgId,
    title: incident.title.trim().normalize('NFC'),
    severity: incident.severity,
    handlerUserId,
    ...('userId' in incident.openedBy
      ? { openedByUserId: assertUuid(incident.openedBy.userId, 'openedBy') }
      : { openedByOperatorId: assertUuid(incident.openedBy.operatorId, 'openedBy') }),
  });
  if (alertIds.length > 0)
    await tx.update(a).set({ incidentId: id }).where(inArray(a.id, alertIds));
  return (await loadSecurityIncident(tx, id)) as SecurityIncidentRow;
}

/**
 * Closes the incident, or hands it to another Owner or Admin, or both; null when the organisation has no such incident. A closed one
 * stays closed: any change of it is refused. The row is locked first, so two changes at once are one after the other.
 */
export async function changeSecurityIncident(
  tx: TenantTx,
  id: string,
  change: { readonly close?: true; readonly handlerUserId?: string },
): Promise<SecurityIncidentRow | null> {
  const [row] = await tx
    .select({ status: i.status })
    .from(i)
    .where(eq(i.id, assertUuid(id, 'id')))
    .for('update');
  if (!row) return null;
  if (row.status === 'closed') throw new SecurityIncidentClosedError();
  const handlerUserId =
    change.handlerUserId === undefined ? undefined : await assertHandler(tx, change.handlerUserId);
  await tx
    .update(i)
    .set({
      ...(handlerUserId === undefined ? {} : { handlerUserId }),
      ...(change.close ? { status: 'closed' as const, closedAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(i.id, id));
  return loadSecurityIncident(tx, id);
}
