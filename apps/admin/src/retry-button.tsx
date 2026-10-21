'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** "Thử lại" of an error page: renders the same page again on the server, so it asks the API again (Brief UI: lỗi kèm traceId + Thử lại). */
export function RetryButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => start(() => router.refresh())}
      className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
    >
      {pending ? 'Đang thử lại…' : 'Thử lại'}
    </button>
  );
}
