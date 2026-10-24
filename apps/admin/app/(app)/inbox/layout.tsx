import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { readsConversations } from '../../../src/inbox/actions';
import { ConversationList } from '../../../src/inbox/conversation-list';
import { InboxKeys } from '../../../src/inbox/inbox-keys';
import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { SystemPage } from '../../../src/system-page';

export const metadata: Metadata = { title: 'Hộp thư — Gani Platform' };

/** #6 Hộp thư: the list (I1a) beside the open conversation (I1b). The frame has already asked who is signed in (cached). */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role || !readsConversations(role))
    return <SystemPage kind="forbidden" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-20 font-semibold">Hộp thư</h1>
        <InboxKeys />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,2fr)_3fr]">
        <ConversationList role={role} meId={result.me.id} />
        {children}
      </div>
    </div>
  );
}
