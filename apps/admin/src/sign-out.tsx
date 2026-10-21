'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/** Ends the session on the server, empties the cache and reloads on /login: nothing of the person stays in memory (Brief UI §2.6). */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  function signOut() {
    setBusy(true);
    queryClient.clear();
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
