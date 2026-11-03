'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { hoursPath, type BusinessHours } from './hours';
import { draftOf, hoursProblem, sameWeek, weekOf, type DayDraft } from './hours-edit';
import { HoursHead, HoursTable, HoursWeek } from './hours-table';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const time = 'rounded-input border border-border-strong px-2 py-1 disabled:opacity-70';

/**
 * The week as read (2a-i) with "Sửa giờ làm việc" (2a-ii), or the form that changes it. Leaving the form puts the keyboard back on
 * that button; saved, the week reads what the API said.
 */
export function HoursPanel({ workspaceId, hours }: { workspaceId: string; hours: BusinessHours }) {
  const [editing, setEditing] = useState(false);
  const [left, setLeft] = useState<'saved' | 'cancelled' | null>(null);
  const edit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing && left) edit.current?.focus();
  }, [editing, left]);
  if (editing)
    return (
      <HoursForm
        workspaceId={workspaceId}
        hours={hours}
        onLeave={(how) => {
          setLeft(how);
          setEditing(false);
        }}
      />
    );
  return (
    <>
      <HoursWeek hours={hours} />
      {left === 'saved' ? <p role="status">Đã lưu giờ làm việc.</p> : null}
      <div>
        <button ref={edit} type="button" className={primary} onClick={() => setEditing(true)}>
          Sửa giờ làm việc
        </button>
      </div>
    </>
  );
}

/** The week in inputs, saved whole (PUT, waits for the server, no Idempotency-Key: a PUT sets the week). */
function HoursForm({
  workspaceId,
  hours,
  onLeave,
}: {
  workspaceId: string;
  hours: BusinessHours;
  onLeave: (how: 'saved' | 'cancelled') => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const saved = draftOf(hours);
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<BusinessHours, ApiFailure, DayDraft[]>({
    mutationFn: (d) =>
      unwrap(
        api<BusinessHours>(hoursPath(workspaceId), { method: 'PUT', body: { week: weekOf(d) } }),
      ),
    onSuccess: (h) => {
      queries.setQueryData(scopeKey(scope, 'workspace-hours', workspaceId), h);
      onLeave('saved');
    },
  });
  useEffect(() => form.current?.querySelector('input')?.focus(), []);
  const set = (weekday: number, change: Partial<DayDraft>) => {
    setProblem(null);
    save.reset();
    setDraft((all) => all.map((d) => (d.weekday === weekday ? { ...d, ...change } : d)));
  };
  const busy = save.isPending;
  return (
    <form
      ref={form}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const p = hoursProblem(draft);
        setProblem(p);
        if (!p) save.mutate(draft);
      }}
    >
      <HoursHead hours={hours} />
      <HoursTable
        days={draft}
        cell={(d, column, name) =>
          column === 'open' ? (
            <input
              type="checkbox"
              aria-label={name}
              checked={d.open}
              disabled={busy}
              onChange={(e) => set(d.weekday, { open: e.target.checked })}
            />
          ) : (
            <input
              type="time"
              className={time}
              aria-label={name}
              value={d[column]}
              disabled={!d.open || busy}
              onChange={(e) => set(d.weekday, { [column]: e.target.value })}
            />
          )
        }
      />
      {problem ? <p role="alert">{problem}</p> : null}
      {save.isError ? (
        <div role="alert" className="flex flex-col gap-1">
          <p>{save.error.error.message}</p>
          {save.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className={primary}
          disabled={sameWeek(draft, saved) || busy}
          aria-busy={busy}
        >
          {busy ? 'Đang lưu…' : 'Lưu giờ làm việc'}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => onLeave('cancelled')}
        >
          Hủy
        </button>
      </div>
    </form>
  );
}
