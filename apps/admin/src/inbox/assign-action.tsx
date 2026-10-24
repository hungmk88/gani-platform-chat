'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { membersPath } from '../members/list';
import { ROLE_NAME } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiPages, useApiQuery, useScope } from '../query/provider';
import type { WorkspaceMemberList } from '../workspaces/workspace-members';
import { assigneesOf } from './assign';
import type { Conversation } from './list';

type MemberPage = components['schemas']['MemberPage'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/** "Gán lại" and its dialog (#6, Phụ lục B row 16): the dialog reads the members only once opened. */
export function AssignAction({ c }: { c: Conversation }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${button} self-start`} onClick={() => setOpen(true)}>
        Gán lại
      </button>
      {open ? <AssignDialog c={c} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Pick a member of the conversation's workspace, then `POST …/assign` with the version last read, waiting for the server (CLAUDE.md "chuyển"). One Idempotency-Key
 * per person picked, kept when the same is sent again after a failure. 422 invalid_assignee and 409 version_conflict say their
 * sentence of the P9 table; a conflict reads the conversation again.
 */
function AssignDialog({ c, onClose }: { c: Conversation; onClose: () => void }) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ to: string; key: string } | null>(null);
  const members = useApiPages<MemberPage>(['members'], membersPath);
  // The people of the conversation's workspace (N159); if they cannot be read, everyone is offered and the API checks.
  const people = useApiQuery<WorkspaceMemberList>(
    ['workspaces', c.workspaceId, 'members'],
    `/v1/workspaces/${encodeURIComponent(c.workspaceId)}/members`,
  );
  const inWorkspace = people.data ? new Set(people.data.data.map((p) => p.memberId)) : null;
  const holder: string | null = c.assignedUserId; // null dropped by the generated type (CLAUDE.md)
  const options = assigneesOf(
    members.data?.pages.flatMap((p) => p.data) ?? [],
    holder,
    inWorkspace,
  );
  const [to, setTo] = useState('');
  const assign = useMutation<Conversation, ApiFailure, { to: string; key: string }>({
    mutationFn: ({ to, key }) =>
      unwrap(
        api<Conversation>(`/v1/conversations/${encodeURIComponent(c.id)}/assign`, {
          method: 'POST',
          body: { version: c.version, toUserId: to },
          idempotencyKey: key,
        }),
      ),
    onSuccess: (next) => {
      last.current = null;
      queries.setQueryData(scopeKey(scope, 'conversation', c.id), next);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
      dialog.current?.close();
    },
    onError: ({ error }) => {
      if (error.action === 'reload')
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversation', c.id) });
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const chosen = to || options[0]?.userId || '';
  const submit = () => {
    if (assign.isPending || !chosen) return;
    const key = last.current?.to === chosen ? last.current.key : crypto.randomUUID();
    last.current = { to: chosen, key };
    assign.mutate({ to: chosen, key });
  };
  const error = assign.error?.error ?? members.error?.error ?? null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="assign-title"
      onClose={onClose}
      className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="assign-title" className="text-16 font-semibold">
          Gán lại hội thoại
        </h3>
        {members.isPending || people.isPending ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải thành viên…
          </p>
        ) : options.length === 0 && !members.hasNextPage ? (
          <p>
            Chưa có ai khác nhận được hội thoại này. Thêm người vào workspace ở Cài đặt › Workspace.
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            Người nhận
            <select
              value={chosen}
              className="rounded-input border border-border-strong px-3 py-2"
              onChange={(e) => setTo(e.target.value)}
            >
              {options.map(({ userId, member }) => (
                <option key={userId} value={userId}>
                  {member.name ?? member.email} ({ROLE_NAME[member.role]})
                </option>
              ))}
            </select>
          </label>
        )}
        {members.hasNextPage ? (
          <button
            type="button"
            className={`${button} self-start`}
            disabled={members.isFetchingNextPage}
            aria-busy={members.isFetchingNextPage}
            onClick={() => void members.fetchNextPage()}
          >
            {members.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm người'}
          </button>
        ) : null}
        <p className="text-12 text-text-muted">
          {inWorkspace
            ? 'Chỉ hiện người thuộc workspace của hội thoại.'
            : 'Người nhận phải thuộc workspace của hội thoại; hệ thống kiểm lại khi gán.'}
        </p>
        {error ? (
          <div role="alert">
            <p>{error.message}</p>
            {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={assign.isPending || !chosen}
            aria-busy={assign.isPending}
          >
            {assign.isPending ? 'Đang gán…' : 'Gán'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
