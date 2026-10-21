'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** "Thử lại" of an error state: one button, locked while it asks again (Brief UI: lỗi kèm traceId + Thử lại). */
export function RetryAction({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      onClick={onRetry}
      className="self-start rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
    >
      {busy ? 'Đang thử lại…' : 'Thử lại'}
    </button>
  );
}

/** "Thử lại" of an error page: renders the same page again on the server, so it asks the API again. */
export function RetryButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <RetryAction busy={pending} onRetry={() => start(() => router.refresh())} />;
}
