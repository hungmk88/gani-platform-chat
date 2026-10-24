import Link from 'next/link';

import type { NavItem } from './nav';

/**
 * A screen of the menu that is not built yet (most wait for their API, QUESTIONS.md U25–U31): one sentence and one action to a
 * screen that is, instead of a 404 whose "Về trang chính" would come back here (`/overview` is the home of Owner, Admin, Manager).
 */
export function PendingPage({ item, go }: { item: NavItem; go: NavItem }) {
  return (
    <main className="mx-auto flex max-w-[560px] flex-col gap-3 p-8">
      <h1 className="text-20 font-semibold">{item.label}: màn này chưa có trong bản hiện tại.</h1>
      <p className="text-text-muted">
        Màn đang chờ API của hệ thống, xong sẽ hiện ở đây. Trong lúc chờ, dùng các màn đã có trong
        menu.
      </p>
      <div>
        <Link
          className="inline-block rounded-input bg-accent px-4 py-2 text-accent-on"
          href={go.href}
        >
          {go.label}
        </Link>
      </div>
    </main>
  );
}
