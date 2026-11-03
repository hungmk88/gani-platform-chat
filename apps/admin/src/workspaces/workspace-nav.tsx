import Link from 'next/link';

import { TABS, type Tab } from './tabs';

/** The links between the tabs of /settings/workspace (links, not a tablist, as /me and /settings/customer-data). */
export function WorkspaceNav({ tab }: { tab: Tab }) {
  return (
    <nav aria-label="Phần workspace" className="flex gap-2 border-b border-border">
      {TABS.map(([k, label]) => (
        <Link
          key={k}
          href={`/settings/workspace?tab=${k}`}
          aria-current={tab === k ? 'page' : undefined}
          className={`px-3 py-2 ${tab === k ? 'border-b-2 border-accent font-semibold' : 'text-text-muted'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
