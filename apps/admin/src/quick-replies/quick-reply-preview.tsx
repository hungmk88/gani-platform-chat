'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  missingOf,
  previewPath,
  quickReplyError,
  type QuickReply,
  type QuickReplyPreview,
} from './quick-replies';

/**
 * "Xem trước" (#22, `POST /v1/quick-replies/{id}/preview`, C7c3, N163): the template as a customer would read it, with a sample
 * customer, the reader's own name, the company's name and the workspace's number; the text as plain text. A variable the API could
 * not fill stays as written and is said in words. Only reads: under the key of the workspace's templates, so a change reads it again.
 */
export function PreviewQuickReplyDialog({
  reply,
  onClose,
}: {
  reply: QuickReply;
  onClose: () => void;
}) {
  const scope = useScope();
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useQuery<QuickReplyPreview, ApiFailure>({
    queryKey: scopeKey(
      scope,
      'quick-replies',
      reply.workspaceId,
      'preview',
      reply.id,
      reply.updatedAt,
    ),
    queryFn: () => unwrap(api<QuickReplyPreview>(previewPath(reply.id), { method: 'POST' })),
  });
  useEffect(() => dialog.current?.showModal(), []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="qr-preview-title"
      onClose={onClose}
      className="m-auto w-[560px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="qr-preview-title" className="text-16 font-semibold">
          Xem trước mẫu /{reply.shortcut}
        </h3>
        {preview.isPending ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang dựng bản xem trước…
          </p>
        ) : preview.isError ? (
          <div role="alert" className="flex flex-col gap-2">
            <p>{quickReplyError(preview.error.error, reply.shortcut)}</p>
            {preview.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {preview.error.error.traceId}</p>
            ) : null}
            <RetryAction onRetry={() => void preview.refetch()} busy={preview.isFetching} />
          </div>
        ) : (
          <>
            <p className="text-12 text-text-muted">
              Dữ liệu mẫu: một tên khách mẫu, tên của bạn, tên công ty và SĐT liên hệ của workspace.
            </p>
            <p className="whitespace-pre-wrap rounded-card border border-border p-3">
              {preview.data.text}
            </p>
            {preview.data.unresolved.length ? (
              <div>
                <p>Chưa điền được (người gửi phải tự điền trong Hộp thư):</p>
                <ul className="list-disc pl-6">
                  {missingOf(preview.data.unresolved).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="self-start rounded-input border border-border-strong px-4 py-2"
          onClick={() => dialog.current?.close()}
        >
          Đóng
        </button>
      </div>
    </dialog>
  );
}
