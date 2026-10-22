'use client';

import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import {
  emailOf,
  invitedText,
  inviteError,
  MAX_EMAIL,
  ROLE_NAME,
  type Invitation,
  type OrgRole,
} from './invite';

const input = 'rounded-input border border-border-strong px-3 py-2';

/**
 * "Mời thành viên" (#19, N152): `POST /v1/members/invite`, waiting for the server (it creates a member). One Idempotency-Key per
 * email and role: sending the same again after a failure reuses it, so the API answers once and sends one email.
 */
export function InviteForm({ roles }: { roles: readonly OrgRole[] }) {
  const last = useRef<{ what: string; key: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>(roles.includes('sales') ? 'sales' : roles[0]!);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Invitation | null>(null);

  const invite = useMutation<Invitation, ApiFailure, { email: string; role: OrgRole; key: string }>(
    {
      mutationFn: ({ email, role, key }) =>
        unwrap(
          api<Invitation>('/v1/members/invite', {
            method: 'POST',
            body: { email, role },
            idempotencyKey: key,
          }),
        ),
      onSuccess: (i) => {
        last.current = null;
        setDone(i);
        setEmail('');
      },
    },
  );

  const submit = () => {
    if (invite.isPending) return;
    const checked = emailOf(email);
    setDone(null);
    if (!checked.ok) return setProblem(checked.problem);
    setProblem(null);
    const what = `${checked.email} ${role}`;
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    invite.mutate({ email: checked.email, role, key });
  };

  const error = invite.error?.error ?? null;
  return (
    <form
      aria-labelledby="invite-title"
      className="flex max-w-[480px] flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 id="invite-title" className="text-16 font-semibold">
        Mời thành viên
      </h2>
      <label className="flex flex-col gap-1">
        Email
        <input
          type="email"
          autoComplete="off"
          maxLength={MAX_EMAIL}
          value={email}
          aria-invalid={problem ? true : undefined}
          className={input}
          onChange={(e) => {
            setEmail(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        Vai trò
        <select value={role} className={input} onChange={(e) => setRole(e.target.value as OrgRole)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAME[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-12 text-text-muted">
        Link mời gửi qua email, dùng được một lần, hạn theo hệ thống. Owner và Admin phải cài xác
        thực 2 lớp khi nhận lời mời.
        {roles.includes('owner') ? null : ' Admin không mời được vai trò Owner.'}
      </p>
      {problem ? <p role="alert">{problem}</p> : null}
      {error ? (
        <div role="alert">
          <p>{inviteError(error)}</p>
          {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        </div>
      ) : null}
      {done ? <p role="status">{invitedText(done)}</p> : null}
      <button
        type="submit"
        className="self-start rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
        disabled={invite.isPending}
        aria-busy={invite.isPending}
      >
        {invite.isPending ? 'Đang gửi…' : 'Gửi lời mời'}
      </button>
    </form>
  );
}
