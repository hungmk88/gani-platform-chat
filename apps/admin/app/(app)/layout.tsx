import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { readsConversations } from '../../src/inbox/actions';
import { roleOf } from '../../src/me';
import { getMe, getSecurityStatus } from '../../src/me.server';
import { scopeId, type Scope } from '../../src/query/keys';
import { QueryProvider } from '../../src/query/provider';
import { RealtimeProvider } from '../../src/realtime/realtime';
import { Shell } from '../../src/shell';
import { SystemPage } from '../../src/system-page';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Who is signed in and whether 2FA must be set up first (security-status exists today), then who they are (U32).
  const status = await getSecurityStatus();
  if (status.kind === 'signed_out') redirect('/login');
  if (status.kind === 'must_set_up') redirect('/two-factor/setup');
  if (status.kind === 'error') return <SystemPage kind="error" traceId={status.traceId} />;
  const result = await getMe();
  if (result.kind === 'signed_out') redirect('/login');
  if (result.kind === 'two_factor_setup') redirect('/two-factor/setup');
  if (result.kind === 'error') return <SystemPage kind="error" traceId={result.traceId} />;
  const role = roleOf(result.me);
  if (!role) return <SystemPage kind="forbidden" />;
  const scope: Scope = { orgId: result.me.org?.id ?? null, workspaceId: null };
  const shell = (
    <Shell me={result.me} role={role}>
      {children}
    </Shell>
  );
  return (
    <QueryProvider key={scopeId(scope)} scope={scope}>
      {readsConversations(role) ? (
        // Read at request time: empty in production (same origin behind the proxy), the API's origin in dev and e2e.
        <RealtimeProvider origin={process.env['REALTIME_ORIGIN'] ?? ''}>{shell}</RealtimeProvider>
      ) : (
        shell
      )}
    </QueryProvider>
  );
}
