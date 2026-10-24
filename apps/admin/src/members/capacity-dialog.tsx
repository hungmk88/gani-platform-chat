'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { components } from '../api/schema';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { capacityError, capacityValue, MAX_CAPACITY, withMember, type Member } from './list';

type Page = components['schemas']['MemberPage'];

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Giới hạn tải" of one member (#19, `PATCH /v1/members/{id}/capacity`, C9, N156): how many conversations they hold at once,
 * waiting for the server; the row then takes the API's answer. Setting a value is idempotent, so no Idempotency-Key (N156).
 */
export function CapacityDialog({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: (m: Member) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(String(member.maxConcurrentConversations ?? ''));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<Member, ApiFailure, number>({
    mutationFn: (max) =>
      unwrap(
        api<Member>(`/v1/members/${encodeURIComponent(member.id)}/capacity`, {
          method: 'PATCH',
          body: { maxConcurrentConversations: max },
        }),
      ),
    onSuccess: (m) => {
      queries.setQueryData<InfiniteData<Page>>(scopeKey(scope, 'members'), (p) => withMember(p, m));
      onDone(m);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const submit = () => {
    if (save.isPending) return;
    const max = capacityValue(value);
    if (typeof max === 'string') return setProblem(max);
    if (max === member.maxConcurrentConversations) return dialog.current?.close();
    save.mutate(max);
  };

  const who = member.name ?? member.email;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="capacity-title"
      onClose={onClose}
      className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="capacity-title" className="text-16 font-semibold">
          Giới hạn tải — {who}
        </h3>
        <label className="flex flex-col gap-1">
          Số hội thoại giữ cùng lúc (1–{MAX_CAPACITY})
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CAPACITY}
            step={1}
            value={value}
            aria-invalid={problem ? true : undefined}
            className="rounded-input border border-border-strong px-3 py-2"
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
            }}
          />
        </label>
        <p className="text-12 text-text-muted">
          Chưa đặt thì theo mặc định của workspace. Đã đặt thì chưa đưa về mặc định được (N156).
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
        {save.error ? (
          <div role="alert">
            <p>{capacityError(save.error.error)}</p>
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
            {save.isPending ? 'Đang lưu…' : 'Lưu giới hạn'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
