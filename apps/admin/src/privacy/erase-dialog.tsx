'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { redirectFor, scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  confirmCodeOf,
  confirmMatches,
  customerTitleOf,
  erasedLines,
  timeText,
  type PrivacyErasure,
  type PrivacyRequest,
} from './privacy';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const erase =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';

/** The answers after which nothing is left to try in this dialog (CEO 30/10): the button goes, only "Đóng" is left. */
const FINAL: Readonly<Record<string, string>> = {
  request_not_pending: 'Yêu cầu này đã được thực hiện trước đó. Danh sách đã được tải lại.',
  not_found: 'Không còn yêu cầu này.',
};
const UNKNOWN = 'Chưa rõ đã xóa hay chưa. Bấm Thử lại: an toàn, không xóa hai lần.';

/**
 * Carrying out an `erase` (#23 PR B2, `POST /v1/privacy-requests/{id}/execute`, planned S5), as the CEO approved it on 30/10: the
 * person types `XOA-<6 last characters>` (point a: ends trimmed, case not counted), the button is never Enter's default, one
 * Idempotency-Key from opening to closing, kept by every "Thử lại" (point b), focus on the field, then on the error or on "Đóng",
 * back to the opener when closed (point c). Nothing is sent again by itself (`retry: false`, CEO 31/10): each try is a click. It
 * never says erased unless the API answered so, and then with the API's figures.
 */
export function EraseDialog({
  request,
  onClose,
}: {
  request: PrivacyRequest;
  onClose: () => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const sending = useRef(false); // a second click before the re-render never sends twice
  const [typed, setTyped] = useState('');
  const code = confirmCodeOf(request.id);
  const run = useMutation<PrivacyErasure, ApiFailure, void>({
    mutationFn: () =>
      unwrap(
        api<PrivacyErasure>(`/v1/privacy-requests/${encodeURIComponent(request.id)}/execute`, {
          method: 'POST',
          idempotencyKey: key,
          retry: false,
        }),
      ),
    onSuccess: () =>
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'privacy-requests') }),
    onError: ({ error }) => {
      const to = redirectFor(error);
      if (to) window.location.assign(to);
      if (error.code === 'request_not_pending')
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'privacy-requests') });
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

  const failure = run.error?.error;
  const final = failure
    ? (FINAL[failure.code] ?? (failure.status === 403 ? failure.message : null))
    : null;
  const over = run.isSuccess || final !== null;
  const matches = confirmMatches(typed, code);
  const shortOfIt = !matches && typed.trim().length >= code.length;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="erase-title"
      aria-describedby="erase-warning"
      onCancel={(e) => {
        if (run.isPending) e.preventDefault(); // the server is erasing: Esc waits like "Hủy"
      }}
      onClose={() => {
        onClose();
        // Back to the button that opened it; once erased, that row has no button left, so the list's heading.
        const back =
          opener.current instanceof HTMLElement && opener.current.isConnected
            ? opener.current
            : null;
        (back ?? document.getElementById('requests-title'))?.focus();
      }}
      className="m-auto w-[520px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="erase-title" className="text-16 font-semibold">
          Xóa vĩnh viễn dữ liệu của {customerTitleOf(request)}
        </h3>
        <p id="erase-warning" className="font-semibold">
          Không hoàn tác được. Dữ liệu đã xóa không khôi phục lại được, kể cả bởi Owner hay quản trị
          nền tảng.
        </p>
        <p>
          Yêu cầu <code className="font-mono">{code}</code> · ghi nhận {timeText(request.createdAt)}{' '}
          bởi {request.requestedBy.name}
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-text-muted">Lý do</span>
          <div
            tabIndex={0}
            role="region"
            aria-label="Lý do"
            className="max-h-24 overflow-y-auto break-words whitespace-pre-wrap rounded-input border border-border p-2"
          >
            {request.reason}
          </div>
        </div>
        <div>
          <p>Sẽ bị xóa:</p>
          <ul className="list-disc pl-6">
            <li>Hồ sơ khách: tên, SĐT, email.</li>
            <li>Định danh kênh (Zalo OA) của khách.</li>
            <li>Nội dung tin khách đã gửi (hội thoại vẫn còn, tin hiện là đã xóa).</li>
          </ul>
        </div>
        {run.isSuccess ? (
          <div role="status" className="flex flex-col gap-1">
            <p className="font-semibold">Đã thực hiện yêu cầu xóa.</p>
            <ul className="list-disc pl-6">
              {erasedLines(run.data.erased).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : (
          <label className="flex flex-col gap-1">
            <span>
              Gõ <code className="font-mono">{code}</code> để xác nhận
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
          {shortOfIt && !over ? 'Chưa khớp.' : run.isPending ? 'Đang xóa, không đóng trang.' : ''}
        </p>
        {failure && !run.isPending ? (
          <div ref={alert} role="alert" tabIndex={-1} className="flex flex-col gap-1">
            <p>
              {final ??
                (failure.code === 'network_error' || failure.status >= 500
                  ? UNKNOWN
                  : failure.message)}
            </p>
            {failure.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failure.traceId}</p>
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
              className={erase}
              disabled={!matches || run.isPending}
              aria-busy={run.isPending}
              onClick={() => {
                if (!matches || sending.current) return;
                sending.current = true;
                run.mutate(undefined, { onSettled: () => (sending.current = false) });
              }}
            >
              {run.isPending ? 'Đang xóa…' : run.isError ? 'Thử lại' : 'Xóa vĩnh viễn'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
