import { ConversationView } from '../../../../src/inbox/conversation-view';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { knownOf } from '../../../../src/inbox/templates';

/** #6 Hộp thư with a conversation open (I1b). The inbox layout has already let only the roles that read conversations in. */
export default async function InboxConversation({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role) return null;
  return (
    <ConversationView key={id} id={id} role={role} meId={result.me.id} known={knownOf(result.me)} />
  );
}
