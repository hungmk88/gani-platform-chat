import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Me } from './me';
import { NavLink } from './nav-link';
import { navFor, type Role } from './nav';
import { SignOutButton } from './sign-out';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * The frame of every screen: the menu of the role on the left, the company, the workspace being worked in (a choice when there are
 * several, T1) and the person on top (Brief UI Phần 2).
 */
export function Shell({
  me,
  role,
  workspaceId,
  children,
}: {
  me: Me;
  role: Role;
  workspaceId: string | null;
  children: ReactNode;
}) {
  const current = me.workspaces.find((w) => w.id === workspaceId);
  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Menu chính"
        className="flex w-[240px] shrink-0 flex-col gap-4 border-r border-border bg-bg-subtle p-4"
      >
        {navFor(role).map((group) =>
          group.items.length === 1 && group.items[0] ? (
            <NavLink key={group.label} href={group.items[0].href}>
              {group.label}
            </NavLink>
          ) : (
            <section key={group.label} aria-label={group.label}>
              <h2 className="px-3 pb-1 text-12 text-text-muted">{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
          <span className="flex items-center gap-2 text-text-muted">
            {me.org ? (
              <>
                {me.org.name} ·{' '}
                {current && me.workspaces.length > 1 ? (
                  <WorkspaceSwitcher workspaces={me.workspaces} current={current.id} />
                ) : (
                  (current?.name ?? 'Chưa có workspace')
                )}
              </>
            ) : (
              'Nền tảng — không thuộc công ty nào'
            )}
          </span>
          <span className="flex items-center gap-2">
            <Link href="/me" className="rounded-input px-2 py-1 hover:bg-bg-subtle">
              {me.name}
            </Link>
            <SignOutButton />
          </span>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
