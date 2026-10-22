// The error answers of the API (RFC 9457, `code` of Brief P9) as the screens act on them: one sentence and one action each.
import type { components } from './schema';

export type Problem = components['schemas']['Problem'];

/** What the screen does (Brief P9 "Frontend nên làm gì"). */
export type ErrorAction =
  | 'sign_in' // to /login, keeping the draft
  | 'set_up_2fa' // to /two-factor/setup (N93)
  | 'reload' // load the data again, then let the person try again
  | 'wait' // wait (Retry-After), then try again
  | 'fields' // show the error at each field
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
// conversation_not_active N146, the Idempotency-Key answers N134, forbidden_origin N136). A code missing here falls back to its HTTP status below.
const CODES: Readonly<Record<string, readonly [ErrorAction, string]>> = {
  validation_failed: ['fields', 'Thông tin chưa hợp lệ. Kiểm tra các ô được đánh dấu.'],
  unauthorized: ['sign_in', 'Phiên đăng nhập đã hết. Đăng nhập lại.'],
  forbidden: ['show', 'Bạn không có quyền làm việc này.'],
  not_found: ['show', 'Không tìm thấy. Có thể đã bị xóa hoặc thuộc công ty khác.'],
  version_conflict: [
    'reload',
    'Dữ liệu vừa được người khác thay đổi. Đã tải lại, kiểm tra rồi làm lại.',
  ],
  conversation_already_claimed: ['reload', 'Hội thoại đã có người nhận.'],
  duplicate_resource: ['show', 'Dữ liệu này đã có.'],
  payload_too_large: ['show', 'Tệp quá lớn.'],
  channel_window_closed: [
    'show',
    'Đã hết khung gửi tin của kênh. Gửi ZNS, gọi điện hoặc tạo task.',
  ],
  autonomy_restricted: ['show', 'Việc này cần người duyệt.'],
  rate_limited: ['wait', 'Thao tác quá nhanh. Đợi một chút rồi thử lại.'],
  internal_error: ['show', 'Đã có lỗi, không phải do bạn. Nếu còn lỗi, gửi mã bên dưới cho Admin.'],
  channel_unavailable: ['show', 'Kênh đang lỗi. Tin được giữ lại để gửi sau.'],
  ai_budget_exceeded: ['show', 'Đã hết hạn mức AI tháng này. Gợi ý AI tạm ẩn.'],
  maintenance: ['show', 'Hệ thống đang bảo trì. Thử lại sau ít phút.'],
  two_factor_setup_required: ['set_up_2fa', 'Cần cài xác thực 2 lớp trước khi dùng hệ thống.'],
  invalid_assignee: ['show', 'Không chuyển được cho người này. Chọn người khác.'],
  conversation_not_active: [
    'reload',
    'Hội thoại chưa có người nhận hoặc đã đóng. Nhận hội thoại rồi trả lời.',
  ],
  idempotency_in_progress: ['wait', 'Yêu cầu trước vẫn đang xử lý. Đợi một chút.'],
  idempotency_key_reused: ['reload', 'Yêu cầu không khớp lần gửi trước. Tải lại rồi làm lại.'],
  forbidden_origin: ['reload', 'Yêu cầu bị chặn. Tải lại trang rồi thử lại.'],
  service_unavailable: ['wait', 'Hệ thống tạm thời chưa phản hồi. Thử lại sau ít phút.'],
};

function byStatus(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'version_conflict';
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
