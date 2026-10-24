'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type { Me } from './me';
import { choiceCookie } from './workspace-choice';

/**
 * "Workspace" in the top bar (T1): the choice goes into a cookie and the frame is read again on the server, which gives the screens
 * a new scope. QueryProvider is keyed by it, so the cache of the old workspace is dropped and its realtime connection closed.
 */
export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: Me['workspaces'];
  current: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2">
      Workspace
      <select
        value={current}
        disabled={pending}
        aria-busy={pending}
        className="rounded-input border border-border-strong px-2 py-1"
        onChange={(e) => {
          document.cookie = choiceCookie(e.target.value);
          start(() => router.refresh());
        }}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {pending ? (
        <span role="status" className="text-12 text-text-muted">
          Đang đổi workspace…
        </span>
      ) : null}
    </label>
  );
}
