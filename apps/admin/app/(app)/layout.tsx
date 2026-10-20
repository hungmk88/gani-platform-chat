import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { roleOf } from '../../src/me';
import { getMe } from '../../src/me.server';
import { Shell } from '../../src/shell';
import { SystemPage } from '../../src/system-page';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = await getMe();
  if (result.kind === 'signed_out') redirect('/login');
  if (result.kind === 'two_factor_setup') redirect('/two-factor');
  if (result.kind === 'error') return <SystemPage kind="error" traceId={result.traceId} />;
  const role = roleOf(result.me);
  if (!role) return <SystemPage kind="forbidden" />;
  return (
    <Shell me={result.me} role={role}>
      {children}
    </Shell>
  );
}
