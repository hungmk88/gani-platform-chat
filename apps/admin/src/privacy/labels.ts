// The words of the requests on a customer's personal data (CEO 30/10), in one module: #23 Dữ liệu khách uses them now, /platform
// later. Keyed by the enums of the contract (`Record`), so a value the contract adds fails the typecheck instead of showing a guess.
import type { PrivacyRequest } from './privacy';

export const KIND: Readonly<Record<PrivacyRequest['kind'], string>> = {
  export: 'Xuất dữ liệu',
  erase: 'Xóa dữ liệu',
};

/** The word of each status and its state colour; never told by colour alone. */
export const STATUS: Readonly<
  Record<PrivacyRequest['status'], readonly [string, 'ok' | 'error' | null]>
> = {
  pending: ['Chờ thực hiện', null],
  done: ['Đã thực hiện', 'ok'],
  failed: ['Không thực hiện được', 'error'],
};
