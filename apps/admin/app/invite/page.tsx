import type { Metadata } from 'next';

import { InviteForm } from '../../src/invite-form';

export const metadata: Metadata = { title: 'Nhận lời mời — Gani Platform' };

/** #4 Nhận lời mời: outside the frame of the app, open to a person who has no account yet; the link of the email lands here. */
export default function Invite() {
  return (
    <main className="mx-auto mt-8 flex max-w-[400px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <InviteForm />
    </main>
  );
}
