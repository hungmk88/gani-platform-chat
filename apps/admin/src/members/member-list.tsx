'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ROLE_NAME, type Role } from '../nav';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiPages, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { expiryOf, invitableRoles, inviteError, type Invitation } from './invite';
import {
  canChangeRole,
  canResetTwoFactor,
  canResend,
  membersPath,
  STATUS,
  twoFactorOf,
  withRenewed,
  type Member,
} from './list';
import { ResetDialog } from './reset-dialog';
import { RoleDialog } from './role-dialog';

type Page = components['schemas']['MemberPage'];

const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const TONE = {
  ok: 'bg-ok-bg text-ok-text',
  warn: 'bg-warn-bg text-warn-text',
  error: 'bg-error-bg text-error-text',
};
const badge = 'rounded-input px-2 py-1 text-12';

/**
 * The members and invitations of the company (#19, `GET /v1/members`, N153), oldest first, by cursor. An invitation not taken can
 * be sent again from its row (`resend-invite`, waiting for the server); its row then shows the new expiry. One key per invitation
 * until it succeeds, as in the invite form. A member's role is changed (`RoleDialog`, N154) and their second factor reset
 * (`ResetDialog`, N155) from its row, each in a dialog.
 */
export function MemberList({ role, meId }: { role: Role; meId: string }) {
  const scope = useScope();
  const queries = useQueryClient();
  const again = useRef<{ id: string; key: string } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (text: string) => {
    resend.reset();
    setNotice(text);
  };
  const list = useApiPages<Page>(['members'], membersPath);
  const resend = useMutation<Invitation, ApiFailure, { member: Member; key: string }>({
    mutationFn: ({ member, key }) =>
      unwrap(
        api<Invitation>(`/v1/members/${encodeURIComponent(member.id)}/resend-invite`, {
          method: 'POST',
          idempotencyKey: key,
        }),
      ),
    onSuccess: (i) => {
      again.current = null;
      queries.setQueryData<InfiniteData<Page>>(scopeKey(scope, 'members'), (p) =>
        withRenewed(p, i),
      );
    },
  });
  const sendAgain = (member: Member) => {
    if (resend.isPending) return;
    setNotice(null);
    const key = again.current?.id === member.id ? again.current.key : crypto.randomUUID();
    again.current = { id: member.id, key };
    resend.mutate({ member, key });
  };

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const failed = resend.error ? resend.variables : undefined;
  return (
    <section aria-labelledby="list-title" className="flex flex-col gap-3">
      <h2 id="list-title" className="text-16 font-semibold">
        Danh sách thành viên
      </h2>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải thành viên…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : rows.length === 0 ? (
        <p>Chưa có thành viên nào. Mời người đầu tiên bằng form ở trên.</p>
      ) : (
        <>
          {resend.error && failed ? (
            <div role="alert">
              <p>
                Chưa gửi lại được lời mời cho {failed.member.email}:{' '}
                {inviteError(resend.error.error)}
              </p>
              {resend.error.error.traceId ? (
                <p className="text-12 text-text-muted">Mã: {resend.error.error.traceId}</p>
              ) : null}
            </div>
          ) : null}
          {resend.isSuccess ? (
            <p role="status">Đã gửi lại lời mời tới {resend.variables.member.email}.</p>
          ) : notice ? (
            <p role="status">{notice}</p>
          ) : null}
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left">
              <thead className="bg-bg-subtle">
                <tr>
                  {['Thành viên', 'Vai trò', '2FA', 'Trạng thái'].map((t) => (
                    <th key={t} scope="col" className="p-2 font-semibold">
                      {t}
                    </th>
                  ))}
                  <th scope="col" className="p-2">
                    <span className="sr-only">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => {
                  const [tone, label] = STATUS[m.status];
                  const tfa = twoFactorOf(m);
                  return (
                    <tr key={m.id}>
                      <td className="p-2">
                        <div>
                          {m.name ?? 'Chưa nhận lời mời'}
                          {m.userId === meId ? ' (bạn)' : ''}
                        </div>
                        <div className="text-12 text-text-muted">{m.email}</div>
                      </td>
                      <td className="p-2">{ROLE_NAME[m.role]}</td>
                      <td className="p-2">
                        {tfa.tone ? (
                          <span className={`${badge} ${TONE[tfa.tone]}`}>{tfa.text}</span>
                        ) : (
                          tfa.text
                        )}
                      </td>
                      <td className="p-2">
                        <span className={`${badge} ${TONE[tone]}`}>{label}</span>
                        {m.expiresAt && m.status === 'pending' ? (
                          <div className="text-12 text-text-muted">Hạn {expiryOf(m.expiresAt)}</div>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          {canChangeRole(role, meId, m) ? (
                            <button
                              type="button"
                              className={button}
                              aria-label={`Đổi vai trò của ${m.name ?? m.email}`}
                              onClick={() => setEditing(m)}
                            >
                              Đổi vai trò
                            </button>
                          ) : null}
                          {canResetTwoFactor(role, meId, m) ? (
                            <button
                              type="button"
                              className={button}
                              aria-label={`Đặt lại 2FA của ${m.name ?? m.email}`}
                              onClick={() => setResetting(m)}
                            >
                              Đặt lại 2FA…
                            </button>
                          ) : null}
                          {canResend(role, m) ? (
                            <button
                              type="button"
                              className={button}
                              aria-label={`Gửi lại lời mời cho ${m.email}`}
                              disabled={resend.isPending}
                              aria-busy={resend.isPending && resend.variables.member.id === m.id}
                              onClick={() => sendAgain(m)}
                            >
                              Gửi lại lời mời
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.hasNextPage ? (
            <button
              type="button"
              className={`${button} self-start`}
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          ) : null}
        </>
      )}
      {editing ? (
        <RoleDialog
          key={editing.id}
          member={editing}
          roles={invitableRoles(role)}
          onClose={() => setEditing(null)}
          onDone={(m) =>
            done(`Đã đổi vai trò của ${m.name ?? m.email} thành ${ROLE_NAME[m.role]}.`)
          }
        />
      ) : null}
      {resetting ? (
        <ResetDialog
          key={resetting.id}
          member={resetting}
          onClose={() => setResetting(null)}
          onDone={(m) =>
            done(
              `Đã đặt lại 2FA của ${m.name ?? m.email}. Mọi phiên đăng nhập của họ đã bị thu hồi.`,
            )
          }
        />
      ) : null}
      <p className="text-12 text-text-muted">
        Team, giới hạn tải riêng và lần đăng nhập cuối: chờ API (N153).
      </p>
    </section>
  );
}
