'use client';

import { useState } from 'react';

/** Ends the session on the server, then reloads on /login so nothing of the person stays in memory (apps/admin/CLAUDE.md §2.6). */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  function signOut() {
    setBusy(true);
    void fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .catch(() => undefined)
      .finally(() => window.location.assign('/login'));
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="rounded-input px-3 py-1 text-accent hover:bg-bg-subtle"
    >
      Đăng xuất
    </button>
  );
}
