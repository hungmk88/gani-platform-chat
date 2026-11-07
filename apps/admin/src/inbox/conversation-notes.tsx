'use client';

import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';
import { noteLineOf, notesPath, type NotePage } from './notes';

/**
 * "Ghi chú nội bộ" of an open conversation (#6, C6, N194; CEO brief 169 P1a): `GET …/notes` newest first by pages, for every role
 * that opens the conversation. The box to add one is P1b. The customer never sees these.
 */
export function ConversationNotes({ id, meId }: { id: string; meId: string }) {
  const notes = useApiPages<NotePage>(['notes', id], (cursor) => notesPath(id, cursor));
  const rows = notes.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section
      aria-labelledby="notes-title"
      className="flex flex-col gap-2 rounded-card bg-note p-3 text-note-text"
    >
      <h3 id="notes-title" className="font-semibold">
        Ghi chú nội bộ
      </h3>
      <p className="text-12">Chỉ nhân viên thấy, khách không thấy.</p>
      {notes.isPending ? (
        <p role="status" aria-busy="true">
          Đang tải ghi chú…
        </p>
      ) : notes.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{notes.error.error.message}</p>
          {notes.error.error.traceId ? (
            <p className="text-12">Mã: {notes.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void notes.refetch()} busy={notes.isFetching} />
        </div>
      ) : rows.length ? (
        <ol aria-label="Ghi chú" className="flex flex-col gap-2">
          {rows.map((n) => {
            const line = noteLineOf(n, meId);
            return (
              <li
                key={n.id}
                className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
              >
                <span className="text-12">
                  {line.by.title ? <abbr title={line.by.title}>{line.by.text}</abbr> : line.by.text}{' '}
                  · <time dateTime={n.createdAt}>{line.at}</time>
                  {line.kind ? ` · ${line.kind}` : null}
                </span>
                {/* Plain text: React escapes it (Brief UI §2.6). */}
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>Chưa có ghi chú nào.</p>
      )}
      {notes.hasNextPage ? (
        <button
          type="button"
          className="self-start rounded-input border border-border-strong px-3 py-1"
          disabled={notes.isFetchingNextPage}
          aria-busy={notes.isFetchingNextPage}
          onClick={() => void notes.fetchNextPage()}
        >
          {notes.isFetchingNextPage ? 'Đang tải…' : 'Tải ghi chú cũ hơn'}
        </button>
      ) : null}
    </section>
  );
}
