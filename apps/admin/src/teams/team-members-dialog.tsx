'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { Member } from '../members/list';
import { ROLE_NAME } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  readAllMembers,
  samePeople,
  type WorkspaceMemberList,
} from '../workspaces/workspace-members';
import { inWorkspace, teamMembersError, teamMembersPath, withCount } from './team-members';
import type { Team, TeamList } from './teams';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Người của team" (#20, `GET/PUT /v1/teams/{id}/members`, N160): the people of the team's workspace with a box each, those of the
 * team ticked; saving sets the whole list. Waits for the server, no Idempotency-Key (a PUT sets the list); the count of the row
 * then takes the answer.
 */
export function TeamMembersDialog({
  team,
  onClose,
  onDone,
}: {
  team: Team;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLFieldSetElement>(null);
  const current = useApiQuery<WorkspaceMemberList>(
    ['teams', team.id, 'members'],
    teamMembersPath(team.id),
  );
  const staff = useApiQuery<WorkspaceMemberList>(
    ['workspaces', team.workspaceId, 'members'],
    `/v1/workspaces/${encodeURIComponent(team.workspaceId)}/members`,
  );
  const members = useQuery<Member[], ApiFailure>({
    queryKey: scopeKey(scope, 'members', 'all'),
    queryFn: readAllMembers,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(current.data?.data.map((m) => m.memberId));
  const save = useMutation<WorkspaceMemberList, ApiFailure, string[]>({
    mutationFn: (memberIds) =>
      unwrap(
        api<WorkspaceMemberList>(teamMembersPath(team.id), {
          method: 'PUT',
          body: { memberIds },
        }),
      ),
    onSuccess: (list) => {
      queries.setQueryData(scopeKey(scope, 'teams', team.id, 'members'), list);
      queries.setQueryData<TeamList>(scopeKey(scope, 'teams', team.workspaceId), (l) =>
        withCount(l, team.id, list.data.length),
      );
      onDone(list.data.length);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const loading = current.isPending || staff.isPending || members.isPending;
  const failed = current.error ?? staff.error ?? members.error;
  // Where the keyboard starts (as #411): the dialog while it reads, then the first box of the list; never "Hủy", the only
  // button while it reads (one Tab from it left the dialog, Enter closed it). An error or an empty list keeps the dialog.
  useEffect(
    () => (list.current?.querySelector('input') ?? dialog.current)?.focus(),
    [loading],
  );
  const people = staff.data ? inWorkspace(members.data ?? [], staff.data) : [];
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const submit = () => {
    if (save.isPending || !current.data) return;
    if (samePeople(chosen, current.data)) return dialog.current?.close();
    save.mutate([...chosen]);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="team-members-title"
      tabIndex={-1}
      onClose={onClose}
      className="m-auto w-[520px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="team-members-title" className="text-16 font-semibold">
          Người của team — {team.name}
        </h3>
        {loading ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải người của workspace…
          </p>
        ) : failed ? (
          <div role="alert" className="flex flex-col gap-2">
            <p>{failed.error.message}</p>
            {failed.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failed.error.traceId}</p>
            ) : null}
            <RetryAction
              busy={current.isFetching || staff.isFetching || members.isFetching}
              onRetry={() => {
                void current.refetch();
                void staff.refetch();
                void members.refetch();
              }}
            />
          </div>
        ) : people.length === 0 ? (
          <p>Workspace này chưa có ai. Chọn người ở Cài đặt › Workspace, nút "Người".</p>
        ) : (
          <fieldset ref={list} className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            <legend className="pb-2">
              Đã chọn {chosen.size} / {people.length} người của workspace.
            </legend>
            {people.map((m) => (
              <label key={m.id} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={chosen.has(m.id)}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                />
                <span>
                  {m.name ?? m.email} · {ROLE_NAME[m.role]}
                  <span className="block text-12 text-text-muted">{m.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {save.error ? (
          <div role="alert">
            <p>{teamMembersError(save.error.error)}</p>
            {save.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending || loading || Boolean(failed)}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu người của team'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
