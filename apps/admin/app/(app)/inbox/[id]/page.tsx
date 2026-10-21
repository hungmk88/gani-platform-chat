import { ConversationView } from '../../../../src/inbox/conversation-view';
import { getMe } from '../../../../src/me.server';

/** #6 Hộp thư with a conversation open (I1b). The inbox layout has already let only the roles that read conversations in. */
export default async function InboxConversation({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  if (result.kind !== 'ok') return null;
  return <ConversationView key={id} id={id} meId={result.me.id} />;
}
