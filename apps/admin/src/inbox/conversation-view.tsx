'use client';

import Link from 'next/link';

import type { components } from '../api/schema';
import { useApiPages, useApiQuery } from '../query/provider';
import type { Role } from '../nav';
import { useConversationRealtime } from '../realtime/use-conversation-realtime';
import { RetryAction } from '../retry-button';
import { AssignAction } from './assign-action';
import { assignsFromList, canAssign } from './assign';
import { canReply, DELIVERY_LABEL, isLocal } from './composer';
import { ReplyBox } from './reply-box';
import type { Known } from './templates';
import { ConversationActions } from './conversation-actions';
import { Holder } from './holder';
import { HOLD_LABEL, STATE_LABEL } from './list';
import { inReadingOrder, KIND_LABEL, messagesPath, senderOf } from './messages';

type Conversation = components['schemas']['Conversation'];
type MessagePage = components['schemas']['MessagePage'];

const TIME = new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

function Failure({
  error,
  onRetry,
  busy,
}: {
  error: { message: string; traceId: string | null };
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2">
      <p>{error.message}</p>
      {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
      <RetryAction onRetry={onRetry} busy={busy} />
    </div>
  );
}

/** The middle column of the Inbox (#6, I1b, I2): the conversation, its messages and the reply box. What a customer sent is plain text. */
export function ConversationView({
  id,
  role,
  meId,
  known,
}: {
  id: string;
  role: Role;
  meId: string;
  known: Known;
}) {
  const conversation = useApiQuery<Conversation>(
    ['conversation', id],
    `/v1/conversations/${encodeURIComponent(id)}`,
  );
  const messages = useApiPages<MessagePage>(['messages', id], (cursor) => messagesPath(id, cursor));
  useConversationRealtime(id);

  if (conversation.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải hội thoại…
      </p>
    );
  if (conversation.isError) {
    const { error } = conversation.error;
    // Another tenant's or a hidden conversation is a 404 like one that does not exist (P9); a malformed id is no better.
    if (error.code === 'not_found' || error.code === 'validation_failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <p>Không tìm thấy hội thoại. Có thể đã bị xóa hoặc bạn không còn được xem.</p>
          <Link href="/inbox" className="rounded-input bg-accent px-4 py-2 text-accent-on">
            Về danh sách
          </Link>
        </div>
      );
    return (
      <Failure
        error={error}
        onRetry={() => void conversation.refetch()}
        busy={conversation.isFetching}
      />
    );
  }

  const c = conversation.data;
  const rows = inReadingOrder(messages.data?.pages.map((p) => p.data) ?? []);
  return (
    <section
      aria-label="Hội thoại"
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h2 className="text-16 font-semibold">
          {c.afterHoursHold ? HOLD_LABEL : STATE_LABEL[c.state]}
        </h2>
        <span className="text-12 text-text-muted">
          Phụ trách: <Holder c={c} meId={meId} named={assignsFromList(role)} />
        </span>
      </header>
      <ConversationActions c={c} role={role} meId={meId} />
      {assignsFromList(role) && canAssign(c) ? <AssignAction key={c.id} c={c} /> : null}
      {messages.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải tin nhắn…
        </p>
      ) : messages.isError ? (
        <Failure
          error={messages.error.error}
          onRetry={() => void messages.refetch()}
          busy={messages.isFetching}
        />
      ) : rows.length === 0 ? (
        <p>Chưa có tin nhắn trong hội thoại này.</p>
      ) : (
        <>
          {messages.hasNextPage ? (
            <button
              type="button"
              className="self-center rounded-input border border-border-strong px-3 py-1"
              disabled={messages.isFetchingNextPage}
              aria-busy={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              {messages.isFetchingNextPage ? 'Đang tải…' : 'Tải tin cũ hơn'}
            </button>
          ) : null}
          <ol aria-label="Tin nhắn" className="flex flex-col gap-3">
            {rows.map((m) => (
              <li
                key={m.id}
                className={`flex max-w-[80%] flex-col gap-1 rounded-card p-3 ${m.senderKind === 'customer' ? 'self-start bg-bg-subtle' : 'self-end border border-border'}`}
              >
                <span className="text-12 text-text-muted">
                  {senderOf(m, meId)} ·{' '}
                  <time dateTime={m.platformSentAt ?? m.createdAt}>
                    {TIME.format(new Date(m.platformSentAt ?? m.createdAt))}
                  </time>
                  {isLocal(m)
                    ? ' · Đang gửi…'
                    : m.deliveryStatus
                      ? ` · ${DELIVERY_LABEL[m.deliveryStatus]}`
                      : null}
                </span>
                {KIND_LABEL[m.kind] ? (
                  <span className="text-12 text-text-muted">{KIND_LABEL[m.kind]}</span>
                ) : null}
                {/* Plain text only: React escapes it, no HTML or markdown, no link preview (Brief UI §2.6, T2). */}
                {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
              </li>
            ))}
          </ol>
        </>
      )}
      {canReply(c, role, meId) ? (
        <ReplyBox conversationId={c.id} workspaceId={c.workspaceId} meId={meId} known={known} />
      ) : null}
      <p className="text-12 text-text-muted">Không áp dụng AI ở khung này.</p>
    </section>
  );
}
