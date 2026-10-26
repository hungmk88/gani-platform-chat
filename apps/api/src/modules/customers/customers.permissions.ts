import type { OrgRole } from '@gani/db';

// Phụ lục B, Khách hàng: every role sees the list and a profile ("Xem danh sách khách", "Xem hồ sơ khách"); Marketing and Viewer see
// them masked ("Che"), as for "Xem SĐT đầy đủ".
const MASKED: readonly OrgRole[] = ['marketing', 'viewer'];

/** True when the role sees a phone and an email only masked. */
export const seesCustomersMasked = (role: OrgRole): boolean => MASKED.includes(role);
