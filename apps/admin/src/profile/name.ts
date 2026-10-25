// Changing one's name on #5 Hồ sơ cá nhân (`PATCH /v1/me {name}`, N162): 1–100 characters once trimmed, as the API checks.
import type { ApiError } from '../api/errors';

export const MAX_NAME = 100;

/** The name to send, trimmed like the API, or why it cannot be sent. */
export function nameOf(raw: string): { readonly name: string } | string {
  const name = raw.trim();
  if (!name) return 'Nhập tên.';
  if (name.length > MAX_NAME) return `Tên tối đa ${MAX_NAME} ký tự.`;
  return { name };
}

/** The refusals of `PATCH /v1/me` in words of the screen. */
export function nameError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return `Máy chủ không nhận tên này (1–${MAX_NAME} ký tự).`;
  return error.message;
}
