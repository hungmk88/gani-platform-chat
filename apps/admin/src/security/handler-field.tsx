'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Member } from '../members/list';
import type { ApiFailure } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { readAllMembers } from '../workspaces/workspace-members';
import { handlersOf } from './incident-open';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const field = 'rounded-input border border-border-strong px-3 py-2';

/** The members of the company (same cache as #20, #21) and who of them may handle an incident: an active Owner or Admin. */
export function useHandlers() {
  const scope = useScope();
  const members = useQuery<Member[], ApiFailure>({
    queryKey: scopeKey(scope, 'members', 'all'),
    queryFn: readAllMembers,
  });
  return { members, handlers: members.data ? handlersOf(members.data) : [] };
}

/** "Người xử lý" of #29 (open, hand over): greyed while the members load; their failure with its trace and "Thử lại"; none. */
export function HandlerField({
  members,
  handlers,
  value,
  onChange,
}: {
  members: UseQueryResult<Member[], ApiFailure>;
  handlers: readonly { userId: string; label: string }[];
  value: string | undefined;
  onChange: (userId: string) => void;
}) {
  if (members.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-1">
        <p>Không tải được danh sách người xử lý. {members.error.error.message}</p>
        {members.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {members.error.error.traceId}</p>
        ) : null}
        <button type="button" className={button} onClick={() => void members.refetch()}>
          Thử lại
        </button>
      </div>
    );
  if (members.isSuccess && handlers.length === 0)
    return <p role="alert">Chưa có Owner hoặc Admin đang hoạt động để xử lý sự cố.</p>;
  return (
    <label className="flex flex-col gap-1">
      Người xử lý (Owner hoặc Admin đang hoạt động)
      <select
        value={value ?? ''}
        disabled={!members.isSuccess}
        aria-busy={members.isPending}
        className={field}
        onChange={(e) => onChange(e.target.value)}
      >
        {members.isPending ? <option value="">Đang tải…</option> : null}
        {handlers.map((h) => (
          <option key={h.userId} value={h.userId}>
            {h.label}
          </option>
        ))}
      </select>
    </label>
  );
}
