import type { Metadata } from 'next';

import { ConversationList } from '../../../src/inbox/conversation-list';
import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { SystemPage } from '../../../src/system-page';

export const metadata: Metadata = { title: 'Hộp thư — Gani Platform' };

// The roles that see conversations (Phụ lục B rows 11–12, apps/api permissions.ts); the menu shows /inbox to the same ones.
const READERS = new Set(['owner', 'admin', 'manager', 'sales', 'support']);

/** #6 Hộp thư, the list column (I1a). The frame has already asked who is signed in; the answer is cached for this request. */
export default async function Inbox() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role || !READERS.has(role)) return <SystemPage kind="forbidden" />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-20 font-semibold">Hộp thư</h1>
      <ConversationList role={role} meId={result.me.id} />
    </div>
  );
}
