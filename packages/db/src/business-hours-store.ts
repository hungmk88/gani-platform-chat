import { DEFAULT_WORKING_WEEK, uuidv7, type OpenDay, type WorkingWeek } from '@gani/domain';
import { and, asc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';

import { workspaceHolidays, workspaceHours } from './schema/workspace-hours.js';
import { workspaces } from './schema/workspaces.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The working hours and days off of a workspace (C10-2b, Q7/U44, N192). Row-level security keeps them to the transaction's
// organisation; who may change them is the caller's check. Every write locks the workspace row first (lockWorkspace of the caller, the
// order of the team store: workspace, then what it holds), so two writers of one workspace queue and an overlap check sees the other.
// Nothing is deleted (spec RLS M01 §7 case 11): a day off ends with deleted_at.

export interface DayOffRow {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Another live day off of the workspace shares a date with this one (422 holiday_overlap, CEO 02/11/2026). */
export class HolidayOverlapError extends Error {
  constructor() {
    super('the day off overlaps another one of the workspace');
    this.name = 'HolidayOverlapError';
  }
}

/** The day off ends before today in the workspace's time zone (422 holiday_in_past, CEO 02/11/2026). */
export class HolidayInPastError extends Error {
  constructor() {
    super('the day off is over');
    this.name = 'HolidayInPastError';
  }
}

const dayOffColumns = {
  id: workspaceHolidays.id,
  name: workspaceHolidays.name,
  startsOn: workspaceHolidays.startsOn,
  endsOn: workspaceHolidays.endsOn,
};

/** The week of the workspace, the default one (Monday to Friday 08:00–17:30, break 12:00–13:00) while none is set, and its time zone. */
export async function readWorkingWeek(
  tx: TenantTx,
  workspaceId: string,
): Promise<{ timezone: string; week: WorkingWeek; isDefault: boolean } | null> {
  const ws = assertUuid(workspaceId, 'workspaceId');
  const [workspace] = await tx
    .select({ timezone: workspaces.timezone })
    .from(workspaces)
    .where(and(eq(workspaces.id, ws), isNull(workspaces.deletedAt)));
  if (!workspace) return null;
  const rows = await tx
    .select()
    .from(workspaceHours)
    .where(eq(workspaceHours.workspaceId, ws))
    .orderBy(asc(workspaceHours.weekday));
  if (rows.length === 0)
    return { timezone: workspace.timezone, week: DEFAULT_WORKING_WEEK, isDefault: true };
  const week = Array.from({ length: 7 }, (_, i): OpenDay | null => {
    const row = rows.find((r) => r.weekday === i + 1);
    return row?.opensAt && row.closesAt
      ? {
          opensAt: row.opensAt,
          closesAt: row.closesAt,
          breakStartsAt: row.breakStartsAt,
          breakEndsAt: row.breakEndsAt,
        }
      : null;
  }) as unknown as WorkingWeek;
  return { timezone: workspace.timezone, week, isDefault: false };
}

/** Sets the whole week of a workspace locked before: one row per weekday, a closed day without hours. */
export async function setWorkingWeek(
  tx: TenantTx,
  workspaceId: string,
  week: WorkingWeek,
): Promise<void> {
  const ws = assertUuid(workspaceId, 'workspaceId');
  const { orgId } = currentTenantContext();
  const rows = week.map((day, i) => ({
    id: uuidv7(),
    orgId,
    workspaceId: ws,
    weekday: i + 1,
    opensAt: day?.opensAt ?? null,
    closesAt: day?.closesAt ?? null,
    breakStartsAt: day?.breakStartsAt ?? null,
    breakEndsAt: day?.breakEndsAt ?? null,
  }));
  await tx
    .insert(workspaceHours)
    .values(rows)
    .onConflictDoUpdate({
      target: [workspaceHours.orgId, workspaceHours.workspaceId, workspaceHours.weekday],
      set: {
        opensAt: sql`excluded.opens_at`,
        closesAt: sql`excluded.closes_at`,
        breakStartsAt: sql`excluded.break_starts_at`,
        breakEndsAt: sql`excluded.break_ends_at`,
        updatedAt: sql`now()`,
      },
    });
}

/** The live days off of a workspace that end on or after `from` ("YYYY-MM-DD"), by start. */
export async function listDaysOff(
  tx: TenantTx,
  workspaceId: string,
  from = '0001-01-01',
): Promise<DayOffRow[]> {
  return tx
    .select(dayOffColumns)
    .from(workspaceHolidays)
    .where(
      and(
        eq(workspaceHolidays.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        isNull(workspaceHolidays.deletedAt),
        gte(workspaceHolidays.endsOn, from),
      ),
    )
    .orderBy(asc(workspaceHolidays.startsOn), asc(workspaceHolidays.id));
}

/** Refuses a range that is over in the workspace's time zone, or that shares a date with a live day off other than `except`. */
async function checkDayOff(
  tx: TenantTx,
  q: { workspaceId: string; startsOn: string; endsOn: string; except?: string },
): Promise<void> {
  const [today] = await tx
    .select({ date: sql<string>`(now() AT TIME ZONE ${workspaces.timezone})::date::text` })
    .from(workspaces)
    .where(eq(workspaces.id, q.workspaceId));
  if (today && q.endsOn < today.date) throw new HolidayInPastError();
  const [other] = await tx
    .select({ id: workspaceHolidays.id })
    .from(workspaceHolidays)
    .where(
      and(
        eq(workspaceHolidays.workspaceId, q.workspaceId),
        isNull(workspaceHolidays.deletedAt),
        lte(workspaceHolidays.startsOn, q.endsOn),
        gte(workspaceHolidays.endsOn, q.startsOn),
        ...(q.except ? [ne(workspaceHolidays.id, q.except)] : []),
      ),
    )
    .limit(1);
  if (other) throw new HolidayOverlapError();
}

/** Adds a day off to a workspace locked before. */
export async function createDayOff(
  tx: TenantTx,
  q: { id: string; workspaceId: string; name: string; startsOn: string; endsOn: string },
): Promise<DayOffRow> {
  const id = assertUuid(q.id, 'id');
  const workspaceId = assertUuid(q.workspaceId, 'workspaceId');
  await checkDayOff(tx, { workspaceId, startsOn: q.startsOn, endsOn: q.endsOn });
  const name = q.name.normalize('NFC');
  await tx.insert(workspaceHolidays).values({
    id,
    orgId: currentTenantContext().orgId,
    workspaceId,
    name,
    startsOn: q.startsOn,
    endsOn: q.endsOn,
  });
  return { id, name, startsOn: q.startsOn, endsOn: q.endsOn };
}

/** The live day off `id` of the workspace, locked until the end of the transaction, or null. */
export async function lockDayOff(
  tx: TenantTx,
  workspaceId: string,
  id: string,
): Promise<DayOffRow | null> {
  const [row] = await tx
    .select(dayOffColumns)
    .from(workspaceHolidays)
    .where(
      and(
        eq(workspaceHolidays.id, assertUuid(id, 'id')),
        eq(workspaceHolidays.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        isNull(workspaceHolidays.deletedAt),
      ),
    )
    .for('update');
  return row ?? null;
}

/** Changes a day off locked before (`current`), with the same checks as a new one. */
export async function updateDayOff(
  tx: TenantTx,
  workspaceId: string,
  current: DayOffRow,
  change: { name?: string; startsOn?: string; endsOn?: string },
): Promise<DayOffRow> {
  const next = {
    id: current.id,
    name: (change.name ?? current.name).normalize('NFC'),
    startsOn: change.startsOn ?? current.startsOn,
    endsOn: change.endsOn ?? current.endsOn,
  };
  await checkDayOff(tx, {
    workspaceId: assertUuid(workspaceId, 'workspaceId'),
    startsOn: next.startsOn,
    endsOn: next.endsOn,
    except: current.id,
  });
  await tx
    .update(workspaceHolidays)
    .set({ name: next.name, startsOn: next.startsOn, endsOn: next.endsOn, updatedAt: sql`now()` })
    .where(eq(workspaceHolidays.id, current.id));
  return next;
}

/** Ends a day off locked before (deleted_at). */
export async function deleteDayOff(tx: TenantTx, id: string): Promise<void> {
  await tx
    .update(workspaceHolidays)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(workspaceHolidays.id, assertUuid(id, 'id')));
}
