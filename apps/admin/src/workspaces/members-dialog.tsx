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
import type { Workspace } from './workspace';
import {
  pickable,
  readAllMembers,
  samePeople,
  workspaceMembersError,
  type WorkspaceMemberList,
} from './workspace-members';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Người trong workspace" (#21, `GET/PUT /v1/workspaces/{id}/members`, N159): the members of the company with a box each, those of
 * the workspace ticked; saving sets the whole list. Waits for the server, no Idempotency-Key (a PUT sets the list); takes effect
 * at the next request of each person (N159).
 */
export function MembersDialog({
  workspace,
  onClose,
  onDone,
}: {
  workspace: Workspace;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLFieldSetElement>(null);
  const path = `/v1/workspaces/${encodeURIComponent(workspace.id)}/members`;
  const current = useApiQuery<WorkspaceMemberList>(['workspaces', workspace.id, 'members'], path);
  const members = useQuery<Member[], ApiFailure>({
    queryKey: scopeKey(scope, 'members', 'all'),
    queryFn: readAllMembers,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(current.data?.data.map((m) => m.memberId));
  const save = useMutation<WorkspaceMemberList, ApiFailure, string[]>({
    mutationFn: (memberIds) =>
      unwrap(api<WorkspaceMemberList>(path, { method: 'PUT', body: { memberIds } })),
    onSuccess: (list) => {
      queries.setQueryData(scopeKey(scope, 'workspaces', workspace.id, 'members'), list);
      onDone(list.data.length);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const loading = current.isPending || members.isPending;
  const failed = current.error ?? members.error;
  // Where the keyboard starts (as #411): the dialog while it reads, then the first box of the list; never "Hủy", the only
  // button while it reads (one Tab from it left the dialog, Enter closed it). An error or an empty list keeps the dialog.
  useEffect(
    () => (list.current?.querySelector('input') ?? dialog.current)?.focus(),
    [loading],
  );
  const people = pickable(members.data ?? []);
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
      aria-labelledby="ws-members-title"
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
        <h3 id="ws-members-title" className="text-16 font-semibold">
          Người trong workspace — {workspace.name}
        </h3>
        {loading ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải thành viên…
          </p>
        ) : failed ? (
          <div role="alert" className="flex flex-col gap-2">
            <p>{failed.error.message}</p>
            {failed.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failed.error.traceId}</p>
            ) : null}
            <RetryAction
              busy={current.isFetching || members.isFetching}
              onRetry={() => {
                void current.refetch();
                void members.refetch();
              }}
            />
          </div>
        ) : people.length === 0 ? (
          <p>Công ty chưa có thành viên nào nhận lời mời. Mời ở Cài đặt › Thành viên.</p>
        ) : (
          <fieldset ref={list} className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            <legend className="pb-2">
              Đã chọn {chosen.size} / {people.length} người. Ai được chọn mới làm việc trong
              workspace này.
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
        <p className="text-12 text-text-muted">
          Có hiệu lực từ lần tải kế tiếp của mỗi người; Hộp thư của họ đổi trong vòng 1 phút.
        </p>
        {save.error ? (
          <div role="alert">
            <p>{workspaceMembersError(save.error.error)}</p>
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
            {save.isPending ? 'Đang lưu…' : 'Lưu người trong workspace'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
