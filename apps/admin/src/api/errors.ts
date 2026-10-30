// The error answers of the API (RFC 9457, `code` of Brief P9) as the screens act on them: one sentence and one action each.
import type { components } from './schema';

export type Problem = components['schemas']['Problem'];

/** What the screen does (Brief P9 "Frontend nên làm gì"). */
export type ErrorAction =
  | 'sign_in' // to /login, keeping the draft
  | 'set_up_2fa' // to /two-factor/setup (N93)
  | 'reload' // load the data again, then let the person try again
  | 'wait' // wait (Retry-After), then try again
  | 'show'; // say it; there is nothing else to do

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly action: ErrorAction;
  readonly traceId: string | null;
  /** Seconds of `Retry-After`, when the answer gives it. */
  readonly retryAfter: number | null;
  /** Extension members (RFC 9457 §3.2) such as `assignedUserId` of conversation_already_claimed: ids, never PII. */
  readonly extensions: Readonly<Record<string, unknown>>;
}

// The 15 codes of Brief P9, then the codes the API serves today beyond it (two_factor_setup_required N93, invalid_assignee #147,
// conversation_not_active N146, unresolved_variable N163, the Idempotency-Key answers N134, forbidden_origin N136; invalid_transition
// of conversations and of the planned Ticket, N167). A code missing here falls back to its HTTP status below.
const CODES: Readonly<Record<string, readonly [ErrorAction, string]>> = {
  // The API's 400 names the wrong fields only in `detail`, free English text (ZodPipe), with no structured list a screen could
  // mark fields from; so this says so, it marks nothing. If the BE adds structured field errors, bring back a `fields` action.
  validation_failed: ['show', 'Dữ liệu chưa hợp lệ, kiểm tra lại.'],
  unauthorized: ['sign_in', 'Phiên đăng nhập đã hết. Đăng nhập lại.'],
  forbidden: ['show', 'Bạn không có quyền làm việc này.'],
  not_found: ['show', 'Không tìm thấy. Có thể đã bị xóa hoặc thuộc công ty khác.'],
  // "Đang tải lại" here and for invalid_transition: every screen given 'reload' shows the sentence, then reads again (async).
  version_conflict: [
    'reload',
    'Dữ liệu vừa được người khác thay đổi. Đang tải lại, kiểm tra rồi làm lại.',
  ],
  conversation_already_claimed: ['reload', 'Hội thoại đã có người nhận.'],
  duplicate_resource: ['show', 'Dữ liệu này đã có.'],
  payload_too_large: ['show', 'Tệp quá lớn.'],
  // No ZNS or task in the admin of Đợt 1: say what happened; the reply box adds the reason (WINDOW_REASON).
  channel_window_closed: [
    'show',
    'Kênh không cho gửi tin lúc này. Tin chưa gửi, nội dung vẫn ở ô soạn.',
  ],
  autonomy_restricted: ['show', 'Việc này cần người duyệt.'],
  rate_limited: ['wait', 'Thao tác quá nhanh. Đợi một chút rồi thử lại.'],
  internal_error: ['show', 'Đã có lỗi, không phải do bạn. Nếu còn lỗi, gửi mã bên dưới cho Admin.'],
  // U57 (#414): the API returns this code nowhere yet; sending is asynchronous, retried a limited number of times by the outbound
  // worker (8b), then failed. CEO 30/10: say the end of it too, so it never reads as retried forever.
  channel_unavailable: [
    'show',
    'Kênh đang lỗi. Tin đã được lưu, hệ thống sẽ thử gửi lại. Nếu không gửi được, tin sẽ chuyển sang trạng thái thất bại.',
  ],
  ai_budget_exceeded: ['show', 'Đã hết hạn mức AI tháng này. Gợi ý AI tạm ẩn.'],
  maintenance: ['show', 'Hệ thống đang bảo trì. Thử lại sau ít phút.'],
  two_factor_setup_required: ['set_up_2fa', 'Cần cài xác thực 2 lớp trước khi dùng hệ thống.'],
  // One sentence for conversations (assign, transfer) and tickets: neither code is about one of them only.
  invalid_assignee: ['show', 'Không giao được cho người này. Chọn người khác.'],
  // "Đang tải lại": the reply box starts reading the conversation again as it shows this, and has not finished.
  conversation_not_active: [
    'reload',
    'Không trả lời được: hội thoại chưa có người nhận hoặc đã đóng. Đang tải lại hội thoại.',
  ],
  invalid_transition: [
    'reload',
    'Trạng thái vừa đổi nên không làm được thao tác này. Đang tải lại, kiểm tra rồi làm lại.',
  ],
  unresolved_variable: [
    'show',
    'Tin còn biến {{…}} chưa điền. Điền các ô dưới ô soạn rồi gửi lại.',
  ],
  idempotency_in_progress: ['wait', 'Yêu cầu trước vẫn đang xử lý. Đợi một chút.'],
  idempotency_key_reused: ['reload', 'Yêu cầu không khớp lần gửi trước. Tải lại rồi làm lại.'],
  forbidden_origin: ['reload', 'Yêu cầu bị chặn. Tải lại trang rồi thử lại.'],
  service_unavailable: ['wait', 'Hệ thống tạm thời chưa phản hồi. Thử lại sau ít phút.'],
  // Not a code of the API: a 409 whose code is not above. Only some screens read again on 'reload', so it neither says nor does it.
  conflict: ['show', 'Dữ liệu vừa thay đổi. Tải lại trang rồi thử lại.'],
};

function byStatus(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  return status >= 500 ? 'internal_error' : 'validation_failed';
}

const MEMBERS = new Set(['type', 'title', 'status', 'code', 'detail', 'traceId']);

/** `Retry-After` in seconds (the API sends seconds, not a date); null when absent or not a number. */
function seconds(header: string | null): number | null {
  const n = header === null ? NaN : Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** An error from its status, its body (a Problem, or anything when a proxy answered) and its Retry-After. */
export function errorOf(status: number, body: unknown, retryAfter: string | null = null): ApiError {
  const p = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const given = typeof p['code'] === 'string' ? p['code'] : null;
  const code = given !== null && given in CODES ? given : byStatus(status);
  const [action, message] = CODES[code] ?? CODES['internal_error']!;
  return {
    status,
    code: given ?? code,
    message,
    action,
    traceId: typeof p['traceId'] === 'string' ? p['traceId'] : null,
    retryAfter: seconds(retryAfter),
    extensions: Object.fromEntries(Object.entries(p).filter(([k]) => !MEMBERS.has(k))),
  };
}

/** The error of a response that is not ok. */
export async function readError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  return errorOf(res.status, body, res.headers.get('retry-after'));
}

/** The API could not be reached at all (no answer). */
export const NETWORK_ERROR: ApiError = {
  status: 0,
  code: 'network_error',
  message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  action: 'wait',
  traceId: null,
  retryAfter: null,
  extensions: {},
};
