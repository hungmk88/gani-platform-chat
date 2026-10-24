import { cookies } from 'next/headers';
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
import { pickWorkspace, WORKSPACE_COOKIE } from '../../src/workspace-choice';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Who is signed in and whether 2FA must be set up first (security-status exists today), then who they are (`GET /v1/me`).
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
  // The workspace chosen in the top bar (T1), among the person's own: changing it changes the key of QueryProvider below.
  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const scope: Scope = {
    orgId: result.me.org?.id ?? null,
    workspaceId: pickWorkspace(result.me.workspaces, chosen),
  };
  const shell = (
    <Shell me={result.me} role={role} workspaceId={scope.workspaceId}>
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
