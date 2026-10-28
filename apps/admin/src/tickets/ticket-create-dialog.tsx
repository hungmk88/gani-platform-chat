'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, type components } from '../api/client';
import type { Customer } from '../customers/customers';
import { membersPath } from '../members/list';
import type { Role } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { redirectFor, scopeKey } from '../query/keys';
import { useApiPages, useApiQuery, useScope } from '../query/provider';
import type { WorkspaceMemberList } from '../workspaces/workspace-members';
import { CustomerField } from './customer-field';
import type { TicketDetail } from './ticket-detail';
import {
  CUSTOMER_GONE,
  MAX_DESCRIPTION,
  MAX_TITLE,
  picksAssignee,
  ticketAssigneesOf,
  ticketBodyOf,
  type TicketCreate,
  type TicketDraft,
  type TicketSource,
} from './ticket-create';
import { PRIORITY } from './tickets';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Tạo ticket" (#15(b), `POST /v1/tickets`, issue #357): title, description, priority and, for Owner/Admin only, who gets it
 * (stage 1 of `picksAssignee`). Waits for the server; then opens the new ticket. One Idempotency-Key for one body: sent again
 * unchanged after a failure it keeps its key, a changed body gets a new one. A failure never clears the form.
 * Opened from a conversation (#358), the ticket is of the conversation's workspace, carries the conversation and its customer
 * (none when it has no customer: `customerId` is left out, never null) and starts with a title the person edits.
 * Opened from the list, the person may pick a customer (#359); one no longer visible (404) is dropped with its own sentence.
 */
export function TicketCreateDialog({
  role,
  onClose,
  from,
}: {
  role: Role;
  onClose: () => void;
  from?: TicketSource;
}) {
  const scope = useScope();
  const workspaceId = from?.workspaceId ?? scope.workspaceId ?? '';
  const queries = useQueryClient();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef<{ what: string; key: string } | null>(null);
  const [draft, setDraft] = useState<TicketDraft>({
    title: from?.title ?? '',
    description: '',
    priority: 'normal',
    assigneeUserId: '',
    customerId: '',
  });
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation<TicketDetail, ApiFailure, { body: TicketCreate; key: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(api<TicketDetail>('/v1/tickets', { method: 'POST', body, idempotencyKey: key })),
    onSuccess: (t) => {
      last.current = null;
      queries.setQueryData(scopeKey(scope, 'ticket', t.id), t);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'tickets') });
      router.push(`/tickets/${encodeURIComponent(t.id)}`);
    },
    onError: ({ error }, { body }) => {
      const to = redirectFor(error); // a session that ended, or 2FA to set up (P9)
      if (to) window.location.assign(to);
      // From the list, a 404 can only be the customer picked (the workspace is the one worked in): drop it, keep the rest.
      if (error.code === 'not_found' && !from && body.customerId) {
        setCustomer(null);
        setDraft((d) => ({ ...d, customerId: '' }));
      }
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (next: Partial<TicketDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
  };
  const submit = () => {
    if (create.isPending) return;
    const made = ticketBodyOf(workspaceId, draft);
    if (typeof made === 'string') return setProblem(made);
    const body: TicketCreate = from
      ? {
          ...made,
          conversationId: from.conversationId,
          ...(from.customerId ? { customerId: from.customerId } : {}),
        }
      : made;
    const what = JSON.stringify(body);
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    create.mutate({ body, key });
  };
  const gone =
    create.error?.error.code === 'not_found' && !from && Boolean(create.variables?.body.customerId);
  const error = problem ?? (gone ? CUSTOMER_GONE : create.error?.error.message) ?? null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="ticket-create-title"
      onClose={onClose}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="ticket-create-title" className="text-16 font-semibold">
          Tạo ticket
        </h3>
        {from ? <p className="text-text-muted">Từ hội thoại với {from.customerName}</p> : null}
        <label className="flex flex-col gap-1">
          Tiêu đề
          <input
            value={draft.title}
            maxLength={MAX_TITLE}
            required
            className={field}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Mô tả (không bắt buộc)
          <textarea
            value={draft.description}
            maxLength={MAX_DESCRIPTION}
            rows={4}
            className={field}
            onChange={(e) => edit({ description: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Ưu tiên
          <select
            value={draft.priority}
            className={field}
            onChange={(e) => edit({ priority: e.target.value as TicketDraft['priority'] })}
          >
            {Object.entries(PRIORITY).map(([p, label]) => (
              <option key={p} value={p}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {from ? null : (
          <CustomerField
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              edit({ customerId: c?.id ?? '' });
            }}
          />
        )}
        {picksAssignee(role) ? (
          <AssigneeField
            workspaceId={workspaceId}
            value={draft.assigneeUserId}
            onChange={(assigneeUserId) => edit({ assigneeUserId })}
          />
        ) : null}
        {error ? (
          <div role="alert" className="flex flex-col gap-1">
            <p>{error}</p>
            {!problem && create.error?.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {create.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Đóng
          </button>
          <button
            type="submit"
            className={primary}
            disabled={create.isPending}
            aria-busy={create.isPending}
          >
            {create.isPending ? 'Đang tạo…' : 'Tạo ticket'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Mounted for Owner/Admin only, so no other role ever asks `GET /v1/members` (stage 1 of `picksAssignee`). */
function AssigneeField({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const members = useApiPages<components['schemas']['MemberPage']>(['members'], membersPath);
  // The people of the workspace (N159); if they cannot be read, everyone is offered and the API checks (422 invalid_assignee).
  const people = useApiQuery<WorkspaceMemberList>(
    ['workspaces', workspaceId, 'members'],
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/members`,
    Boolean(workspaceId),
  );
  const inWorkspace = people.data ? new Set(people.data.data.map((p) => p.memberId)) : null;
  const options = ticketAssigneesOf(members.data?.pages.flatMap((p) => p.data) ?? [], inWorkspace);
  return (
    <label className="flex flex-col gap-1">
      Người nhận
      <select value={value} className={field} onChange={(e) => onChange(e.target.value)}>
        <option value="">Chưa giao</option>
        {options.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
