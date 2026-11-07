'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { redirectFor, scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  mergeLineOf,
  unmergeFailureOf,
  unmergePath,
  type MergeEntry,
  type UnmergeResult,
} from './merges';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const danger =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';

/**
 * "Tách khách" (J3 PR B2, tầng 3; CEO brief 153, 155): `POST /v1/customers/{sourceId}/unmerge`, from a line of "Lịch sử gộp" not
 * undone yet. A checkbox confirms (an unmerge can be merged again, N205 item 3); one Idempotency-Key per dialog, kept by "Thử lại",
 * `retry: false`, no double send; focus as `EraseDialog`. Done: customers, profiles (history, suggestions) and conversations are read
 * again, and a link opens the customer back on its own.
 */
export function UnmergeDialog({ entry, onClose }: { entry: MergeEntry; onClose: () => void }) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const [sure, setSure] = useState(false);
  const line = mergeLineOf(entry);
  const reread = () => {
    for (const part of ['customers', 'customer', 'conversations'])
      void queries.invalidateQueries({ queryKey: scopeKey(scope, part) });
  };
  const run = useMutation<UnmergeResult, ApiFailure, void>({
    mutationFn: () =>
      unwrap(
        api<UnmergeResult>(unmergePath(entry.sourceId), {
          method: 'POST',
          idempotencyKey: key,
          retry: false,
        }),
      ),
    onSuccess: reread,
    onError: ({ error }) => {
      const to = redirectFor(error);
      if (to) window.location.assign(to);
      if (error.status === 409) reread();
    },
  });
  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.showModal();
    box.current?.focus();
  }, []);
  useEffect(() => {
    if (run.isSuccess) done.current?.focus();
    else if (run.isError) alert.current?.focus();
  }, [run.isSuccess, run.isError]);

  const failure = run.error ? unmergeFailureOf(run.error.error) : null;
  const over = run.isSuccess || failure?.final === true;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="unmerge-title"
      aria-describedby="unmerge-rule"
      onCancel={(e) => {
        if (run.isPending) e.preventDefault(); // unmerging: Esc waits like "Hủy"
      }}
      onClose={() => {
        onClose();
        const back =
          opener.current instanceof HTMLElement && opener.current.isConnected
            ? opener.current
            : null;
        (back ?? document.getElementById('customer-merges'))?.focus();
      }}
      className="m-auto w-[520px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="unmerge-title" className="text-16 font-semibold">
          Tách “{line.source}” khỏi khách này?
        </h3>
        <p id="unmerge-rule">
          Các dòng đã chuyển lúc gộp ({line.at}) trả về “{line.source}”; dữ liệu sinh ra sau đó ở
          lại khách này.
        </p>
        {run.isSuccess ? (
          <div role="status" className="flex flex-col gap-1">
            <p className="font-semibold">Đã tách “{line.source}”.</p>
            <Link href={`/customers/${entry.sourceId}`} className="underline">
              Xem hồ sơ “{line.source}”
            </Link>
          </div>
        ) : (
          <label className="flex items-center gap-2">
            <input
              ref={box}
              type="checkbox"
              checked={sure}
              disabled={run.isPending || over}
              onChange={(e) => setSure(e.target.checked)}
            />
            Tôi hiểu thao tác này.
          </label>
        )}
        <p aria-live="polite" className="text-12 text-text-muted">
          {run.isPending ? 'Đang tách, không đóng trang.' : ''}
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
              disabled={!sure || run.isPending}
              aria-busy={run.isPending}
              onClick={() => {
                if (!sure || sending.current) return;
                sending.current = true;
                run.mutate(undefined, { onSettled: () => (sending.current = false) });
              }}
            >
              {run.isPending ? 'Đang tách…' : run.isError ? 'Thử lại' : 'Tách khách'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
