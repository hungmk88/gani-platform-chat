import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mayReadPrompts } from '../../../../src/ai/prompts';
import { PromptTable } from '../../../../src/ai/prompt-table';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';
import { SystemPage } from '../../../../src/system-page';

export const metadata: Metadata = { title: 'AI nội bộ — Gani Platform' };

/**
 * #26 AI nội bộ, Đợt 1 only the prompt versions (E20, CEO 30/10). Owner and Admin as the menu; reading the prompts is Owner/Admin
 * for now only (U66, `mayReadPrompts`). Outside the menu of the role it is the 404 inside the frame, as any such path.
 */
export default async function AiPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/settings/ai') : undefined;
  if (!role || !item) notFound();
  if (!mayReadPrompts(role)) return <SystemPage kind="forbidden" />;
  return <PromptTable item={item} go={builtFor(role)} />;
}
