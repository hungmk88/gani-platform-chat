import { describe, expect, it } from 'vitest';

import { errorOf, readError } from './errors';

describe('errorOf', () => {
  it('reads the code, trace and extension members of a Problem', () => {
    const e = errorOf(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'conversation_already_claimed',
      traceId: 't-1',
      assignedUserId: 'u-2',
    });
    expect(e).toMatchObject({
      status: 409,
      code: 'conversation_already_claimed',
      action: 'reload',
      message: 'Hội thoại đã có người nhận.',
      traceId: 't-1',
      extensions: { assignedUserId: 'u-2' },
    });
  });

  it.each([
    ['validation_failed', 'show'],
    ['unauthorized', 'sign_in'],
    ['two_factor_setup_required', 'set_up_2fa'],
    ['version_conflict', 'reload'],
    ['rate_limited', 'wait'],
    ['internal_error', 'show'],
    ['channel_window_closed', 'show'],
  ] as const)('%s → %s', (code, action) => {
    expect(errorOf(400, { code }).action).toBe(action);
  });

  it.each([
    [401, 'sign_in'],
    [403, 'show'],
    [404, 'show'],
    [409, 'show'],
    [413, 'show'],
    [429, 'wait'],
    [503, 'wait'],
    [500, 'show'],
    [400, 'show'],
  ] as const)(
    'a code it does not know, or no body, falls back to the status %i → %s',
    (status, action) => {
      expect(errorOf(status, { code: 'something_new' }).action).toBe(action);
      expect(errorOf(status, '<html>proxy</html>').action).toBe(action);
    },
  );

  it('never promises what no screen does: no marked fields on a 400, no reload on an unknown 409', () => {
    expect(errorOf(400, { code: 'validation_failed' }).message).toBe(
      'Dữ liệu chưa hợp lệ, kiểm tra lại.',
    );
    const e = errorOf(409, { code: 'not_in_phase' });
    expect(e).toMatchObject({ code: 'not_in_phase', action: 'show' });
    expect(e.message).toBe('Dữ liệu vừa thay đổi. Tải lại trang rồi thử lại.');
    expect(errorOf(409, { code: 'version_conflict' }).action).toBe('reload'); // its screens do read again
    // U57: retried a limited number of times, then failed; never "kept to send later".
    expect(errorOf(502, { code: 'channel_unavailable' }).message).toBe(
      'Kênh đang lỗi. Tin đã được lưu, hệ thống sẽ thử gửi lại. Nếu không gửi được, tin sẽ chuyển sang trạng thái thất bại.',
    );
  });

  it('keeps an unknown code as given, with the sentence of its status', () => {
    const e = errorOf(404, { code: 'lead_gone' });
    expect(e.code).toBe('lead_gone');
    expect(e.message).toBe('Không tìm thấy. Có thể đã bị xóa hoặc thuộc công ty khác.');
  });

  it('reads Retry-After in seconds only', () => {
    expect(errorOf(429, {}, '3').retryAfter).toBe(3);
    expect(errorOf(429, {}, 'Wed, 21 Oct 2026 07:28:00 GMT').retryAfter).toBeNull();
    expect(errorOf(429, {}, null).retryAfter).toBeNull();
  });
});

describe('readError', () => {
  it('reads the body and the Retry-After header', async () => {
    const res = new Response(JSON.stringify({ code: 'rate_limited', traceId: 't-9' }), {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    await expect(readError(res)).resolves.toMatchObject({
      code: 'rate_limited',
      retryAfter: 2,
      traceId: 't-9',
    });
  });

  it('answers a body that is not JSON by its status', async () => {
    await expect(readError(new Response('Bad Gateway', { status: 502 }))).resolves.toMatchObject({
      code: 'internal_error',
      traceId: null,
    });
  });
});
