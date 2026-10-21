'use client';

import { SystemPage } from '../src/system-page';

/** An error of a screen: the digest is the id Next.js writes to the server log next to the cause, the only code shown. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SystemPage
      kind="error"
      traceId={error.digest ?? null}
      action={
        <button
          type="button"
          className="rounded-input bg-accent px-4 py-2 text-accent-on"
          onClick={reset}
        >
          Thử lại
        </button>
      }
    />
  );
}
