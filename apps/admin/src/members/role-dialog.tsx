'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { ROLE_NAME, type OrgRole } from './invite';
import { roleError, withMember, type Member } from './list';

type Page = components['schemas']['MemberPage'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Đổi vai trò" of one member (#19, `PATCH /v1/members/{id}/role`, N154), in a dialog: waits for the server (CLAUDE.md "đổi
 * quyền"), then the row takes the API's answer. Setting a role is idempotent, so no Idempotency-Key (N154).
 */
export function RoleDialog({
  member,
  roles,
  onClose,
  onDone,
}: {
  member: Member;
  roles: readonly OrgRole[];
  onClose: () => void;
  onDone: (m: Member) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState<OrgRole>(member.role);
  const save = useMutation<Member, ApiFailure, OrgRole>({
    mutationFn: (to) =>
      unwrap(
        api<Member>(`/v1/members/${encodeURIComponent(member.id)}/role`, {
          method: 'PATCH',
          body: { role: to },
        }),
      ),
    onSuccess: (m) => {
      queries.setQueryData<InfiniteData<Page>>(scopeKey(scope, 'members'), (p) => withMember(p, m));
      onDone(m);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const who = member.name ?? member.email;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="role-title"
      onClose={onClose}
      className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (role === member.role) return dialog.current?.close();
          save.mutate(role);
        }}
      >
        <h3 id="role-title" className="text-16 font-semibold">
          Đổi vai trò — {who}
        </h3>
        <label className="flex flex-col gap-1">
          Vai trò mới
          <select
            value={role}
            className="rounded-input border border-border-strong px-3 py-2"
            onChange={(e) => setRole(e.target.value as OrgRole)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-12 text-text-muted">
          Có hiệu lực từ lần tải kế tiếp của người này. Lên Owner hoặc Admin thì họ phải cài xác
          thực 2 lớp.
        </p>
        {save.error ? (
          <div role="alert">
            <p>{roleError(save.error.error)}</p>
            {save.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu vai trò'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
