'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';

import type { components } from '../api/schema';
import { useApiPages, useScope } from '../query/provider';
import { neighbour, openId, SHORTCUTS } from './keys';
import { filterOf, listPath, paramsOf } from './list';

type Page = components['schemas']['ConversationPage'];

const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * J/K and ? of the Inbox (#6). The list is read from the cache the list column fills (same key, so no second request); J/K open the
 * next or previous conversation loaded, keeping the filters; ? opens the table of the keys. Not while typing, nor with a modifier.
 */
export function InboxKeys() {
  const router = useRouter();
  const pathname = usePathname();
  const filter = filterOf(useSearchParams());
  const scope = useScope();
  const list = useApiPages<Page>(['conversations', filter], (cursor) =>
    listPath(filter, cursor, scope.workspaceId),
  );
  const table = useRef<HTMLDialogElement>(null);

  const onKey = useEffectEvent((key: string) => {
    if (key === '?') return table.current?.showModal();
    const step = key === 'j' ? 1 : key === 'k' ? -1 : 0;
    if (!step) return;
    const ids = list.data?.pages.flatMap((p) => p.data.map((c) => c.id)) ?? [];
    const to = neighbour(ids, openId(pathname), step);
    if (!to) return;
    const q = paramsOf(filter).toString();
    router.push(`/inbox/${to}${q ? `?${q}` : ''}`);
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        t?.closest('input, textarea, select, dialog, [contenteditable]')
      )
        return;
      const key = e.key.toLowerCase();
      if (key === 'j' || key === 'k' || key === '?') {
        e.preventDefault();
        onKey(key);
      }
    };
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  return (
    <>
      <button
        type="button"
        className={`${button} self-start text-12`}
        aria-keyshortcuts="?"
        onClick={() => table.current?.showModal()}
      >
        Phím tắt (?)
      </button>
      <dialog
        ref={table}
        aria-labelledby="keys-title"
        className="m-auto w-[400px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
      >
        <h2 id="keys-title" className="text-16 font-semibold">
          Bảng phím tắt
        </h2>
        <table className="mt-3 w-full text-left">
          <thead>
            <tr>
              <th scope="col" className="py-1 font-semibold">
                Phím
              </th>
              <th scope="col" className="py-1 font-semibold">
                Việc
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([key, what]) => (
              <tr key={key}>
                <td className="py-1 pr-4">
                  <kbd>{key}</kbd>
                </td>
                <td className="py-1">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-12 text-text-muted">
          Chuyển (T), ghi chú nội bộ (N) và tìm (/) có khi các chức năng này có API.
        </p>
        <button type="button" className={`${button} mt-4`} onClick={() => table.current?.close()}>
          Đóng
        </button>
      </dialog>
    </>
  );
}
