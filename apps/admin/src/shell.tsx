import type { ReactNode } from 'react';

import type { Me } from './me';
import { NavLink } from './nav-link';
import { navFor, type Role } from './nav';

/** The frame of every screen: the menu of the role on the left, the company and the person on top (Brief UI Phần 2). */
export function Shell({ me, role, children }: { me: Me; role: Role; children: ReactNode }) {
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
          <span className="text-text-muted">
            {me.org
              ? `${me.org.name} · ${me.workspaces.map((w) => w.name).join(', ')}`
              : 'Nền tảng — không thuộc công ty nào'}
          </span>
          <span>{me.name}</span>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
