'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, children }: { href: string; children: string }) {
  const current = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`block rounded-input px-3 py-2 ${current ? 'bg-surface font-semibold text-accent' : 'text-text hover:bg-surface'}`}
    >
      {children}
    </Link>
  );
}
