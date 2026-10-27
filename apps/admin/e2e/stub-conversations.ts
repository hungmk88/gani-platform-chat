// The conversations and messages of the e2e stub API (moved out of e2e/stub-api.ts to keep it under 500 lines); each session
// works on its own copy. Never deployed.
import { CUSTOMERS } from './stub-customers';

// The conversations of every workspace of the stub: who may see which is the rule of apps/api permissions.ts (canSee).
const conversation = (
  n: number,
  state: string,
  assignedUserId: string | null,
  hold = false,
  customer: { id: string; displayName: string | null } | null = null,
) => ({
  id: `0190a000-0000-7000-8000-00000000000${n}`,
  workspaceId: 'ws-e2e',
  state,
  afterHoursHold: hold,
  assignedUserId,
  version: 1,
  outcome: state === 'CLOSED' ? 'resolved' : null,
  closedAt: state === 'CLOSED' ? '2026-10-21T03:00:00Z' : null,
  lastMessageAt: `2026-10-21T0${n}:05:00Z`,
  lastCustomerMessageAt: null,
  createdAt: '2026-10-20T00:00:00Z',
  customer,
});
/** A message a customer could send to break a page (T2): it must show as these characters and run nothing. */
export const HOSTILE =
  '<script>window.__xss = 1</script><img src=x onerror="window.__xss = 1">**đậm**';
const message = (
  n: number,
  senderKind: string,
  body: string,
  platformSentAt: string | null,
  senderUserId: string | null = null,
) => ({
  id: `0190b000-0000-7000-8000-00000000000${n}`,
  sequenceNumber: n,
  senderKind,
  senderUserId,
  kind: 'text',
  body,
  platformSentAt,
  createdAt: `2026-10-21T02:0${n}:30Z`,
});
/** The messages of conversation #2 (sales holds it); #5 arrived late from Zalo and was sent before #4. */
export const MESSAGES = [
  message(1, 'customer', 'Chào shop, cho hỏi giá thùng 24 lon.', '2026-10-21T02:01:00Z'),
  message(2, 'bot', 'Dạ em chuyển anh/chị cho nhân viên ạ.', '2026-10-21T02:02:00Z'),
  message(3, 'agent', 'Dạ em chào anh, em gửi báo giá ngay.', null, 'user-sales'),
  message(4, 'customer', HOSTILE, '2026-10-21T02:06:00Z'),
  message(5, 'customer', 'Gửi lúc 02:05, tới sau.', '2026-10-21T02:05:00Z'),
];
export const CONVERSATIONS = [
  // #1 has a named customer (#7), #3 one nobody has named yet; the others have none linked yet (N165).
  conversation(1, 'HUMAN_WAITING_Q', null, false, {
    id: CUSTOMERS[0]!.id,
    displayName: CUSTOMERS[0]!.displayName,
  }),
  conversation(2, 'HUMAN_ACTIVE', 'user-sales'),
  conversation(3, 'PENDING_CUSTOMER', 'user-sales', false, {
    id: CUSTOMERS[1]!.id,
    displayName: null,
  }),
  conversation(4, 'HUMAN_ACTIVE', 'user-manager'),
  conversation(5, 'HUMAN_WAITING_Q', null, true),
  conversation(6, 'CLOSED', 'user-sales'),
];
