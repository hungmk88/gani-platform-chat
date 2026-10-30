// The words of the security alerts and incidents (CEO 30/10), in one module for #29 Bảo mật and, later, /platform.
// A severity is never told by colour alone: it always has its word.
import type { components } from '../api/planned';

export type AlertKind = components['schemas']['SecurityAlert']['kind'];
export type Severity = components['schemas']['SecurityAlert']['severity'];

export const ALERT_KIND: Readonly<Record<AlertKind, string>> = {
  login_failures: 'Đăng nhập sai nhiều lần',
  two_factor_locked: 'Khóa 2FA do nhập sai',
  two_factor_reset: 'Đặt lại 2FA',
  platform_access: 'Truy cập từ quản trị nền tảng',
  webhook_signature_invalid: 'Chữ ký webhook không hợp lệ',
  bulk_export: 'Xuất dữ liệu hàng loạt',
};

/** The word of each severity and its state colour (none, yellow, red), as prototype/dot1/security.js. */
export const SEVERITY: Readonly<Record<Severity, readonly [string, 'warn' | 'error' | null]>> = {
  low: ['Thấp', null],
  medium: ['Trung bình', 'warn'],
  high: ['Cao', 'error'],
  critical: ['Nghiêm trọng', 'error'],
};
