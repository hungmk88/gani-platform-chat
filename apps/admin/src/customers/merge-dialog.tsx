'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { redirectFor, scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { nameOf, phoneText, type Customer } from './customers';
import {
  confirmsMerge,
  MERGE_WORD,
  mergeFailureOf,
  mergePreview,
  sameCustomer,
  type MergeResult,
} from './merges';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const danger =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';
const shown = (v: string | null, phone = false) => (v ? (phone ? phoneText(v) : v) : 'Chưa có');

/**
 * "Gộp khách" (J3 PR B1, tầng 3; CEO brief 153, 155): `POST /v1/customers/merge`. Keep the viewed profile by default; the preview is
 * name, phone, email only (no counts in the contract). `GOP` unlocks the button (never Enter's default); one Idempotency-Key per
 * dialog, kept by "Thử lại", `retry: false`, no double send, no self-merge; focus as `EraseDialog`. Done: customers, profiles and
 * conversations are read again; a profile merged away goes to the kept one.
 */
export function MergeDialog({
  viewed,
  other,
  onClose,
}: {
  viewed: Customer;
  other: Customer;
  onClose: () => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const [keptId, setKeptId] = useState(viewed.id);
  const [typed, setTyped] = useState('');
  const kept = keptId === viewed.id ? viewed : other;
  const merged = keptId === viewed.id ? other : viewed;
  const refused = sameCustomer(kept.id, merged.id);
  const run = useMutation<MergeResult, ApiFailure, void>({
    mutationFn: () =>
      unwrap(
        api<MergeResult>('/v1/customers/merge', {
          method: 'POST',
          body: { sourceId: merged.id, targetId: kept.id },
          idempotencyKey: key,
          retry: false,
        }),
      ),
    onSuccess: () => {
      for (const part of ['customers', 'customer', 'conversations'])
        void queries.invalidateQueries({ queryKey: scopeKey(scope, part) });
    },
    onError: ({ error }) => {
      const to = redirectFor(error);
      if (to) window.location.assign(to);
      if (error.code === 'not_found')
        void queries.invalidateQueries({
          queryKey: scopeKey(scope, 'customer', viewed.id, 'merge-suggestions'),
        });
    },
  });
  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (run.isSuccess) done.current?.focus();
    else if (run.isError) alert.current?.focus();
  }, [run.isSuccess, run.isError]);

  const failure = run.error ? mergeFailureOf(run.error.error) : null;
  const over = run.isSuccess || failure?.final === true;
  const ready = confirmsMerge(typed) && refused === null;
  const after = mergePreview(kept, merged);
  const rows: [string, string, string, string][] = [
    ['Tên', nameOf(kept), nameOf(merged), nameOf(after)],
    ['SĐT', shown(kept.phone, true), shown(merged.phone, true), shown(after.phone, true)],
    ['Email', shown(kept.email), shown(merged.email), shown(after.email)],
  ];

  return (
    <dialog
      ref={dialog}
      aria-labelledby="merge-title"
      aria-describedby="merge-rule"
      onCancel={(e) => {
        if (run.isPending) e.preventDefault(); // merging: Esc waits like "Hủy"
      }}
      onClose={() => {
        onClose();
        if (run.isSuccess && merged.id === viewed.id) router.replace(`/customers/${kept.id}`);
        const back =
          opener.current instanceof HTMLElement && opener.current.isConnected
            ? opener.current
            : null;
        (back ?? document.getElementById('customer-duplicates'))?.focus();
      }}
      className="m-auto w-[640px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="merge-title" className="text-16 font-semibold">
          Gộp khách
        </h3>
        <fieldset className="flex flex-col gap-1" disabled={run.isPending || over}>
          <legend>Giữ hồ sơ nào?</legend>
          {[viewed, other].map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="kept"
                checked={keptId === c.id}
                onChange={() => setKeptId(c.id)}
              />
              {nameOf(c)}
              {c.id === viewed.id ? ' (đang xem)' : ''}
            </label>
          ))}
        </fieldset>
        <table className="w-full text-left">
          <caption className="sr-only">Hồ sơ sau khi gộp</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">Giữ lại</th>
              <th scope="col">Bị gộp vào</th>
              <th scope="col">Sau khi gộp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([field, ...values]) => (
              <tr key={field}>
                <th scope="row" className="pr-2 text-text-muted">
                  {field}
                </th>
                {values.map((v, i) => (
                  <td key={i} className="break-all pr-2">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p id="merge-rule">
          Chuyển sang hồ sơ giữ lại: hội thoại, định danh kênh, ticket, lead, tag (tag và trường tùy
          chỉnh hồ sơ giữ lại đã có thì giữ của nó). Hồ sơ bị gộp sẽ ẩn khỏi danh sách. Tách lại
          được ở &quot;Lịch sử gộp&quot;, nhưng dữ liệu sinh ra sau khi gộp ở lại hồ sơ giữ lại.
        </p>
        {refused ? (
          <p role="alert" className="text-error-text">
            {refused}
          </p>
        ) : null}
        {run.isSuccess ? (
          <p role="status" className="font-semibold">
            Đã gộp &quot;{nameOf(merged)}&quot; vào &quot;{nameOf(run.data.target)}&quot;.
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            <span>
              Gõ <code className="font-mono">{MERGE_WORD}</code> để xác nhận
            </span>
            <input
              ref={input}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              readOnly={run.isPending || over}
              className="rounded-input border border-border-strong px-3 py-2 font-mono"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        )}
        <p aria-live="polite" className="text-12 text-text-muted">
          {run.isPending ? 'Đang gộp, không đóng trang.' : ''}
        </p>
        {failure && !run.isPending ? (
          <div ref={alert} role="alert" tabIndex={-1} className="flex flex-col gap-1">
            <p>{failure.text}</p>
            {run.error?.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {run.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            ref={done}
            type="button"
            className={button}
            disabled={run.isPending}
            onClick={() => dialog.current?.close()}
          >
            {over ? 'Đóng' : 'Hủy'}
          </button>
          {over ? null : (
            <button
              type="button"
              className={danger}
              disabled={!ready || run.isPending}
              aria-busy={run.isPending}
              onClick={() => {
                if (!ready || sending.current) return;
                sending.current = true;
                run.mutate(undefined, { onSettled: () => (sending.current = false) });
              }}
            >
              {run.isPending ? 'Đang gộp…' : run.isError ? 'Thử lại' : 'Gộp khách'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
