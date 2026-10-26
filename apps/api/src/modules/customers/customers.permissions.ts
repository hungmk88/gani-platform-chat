import type { OrgRole } from '@gani/db';

// Phụ lục B, Khách hàng: every role sees the list and a profile ("Xem danh sách khách", "Xem hồ sơ khách"); Marketing and Viewer see
// them masked ("Che"), as for "Xem SĐT đầy đủ". Changing a profile ("Sửa hồ sơ khách") is Owner, Admin, Manager, Sales and Support.
const MASKED: readonly OrgRole[] = ['marketing', 'viewer'];
const EDITORS: readonly OrgRole[] = ['owner', 'admin', 'manager', 'sales', 'support'];

/** True when the role sees a phone and an email only masked. */
export const seesCustomersMasked = (role: OrgRole): boolean => MASKED.includes(role);
export const mayEditCustomers = (role: OrgRole): boolean => EDITORS.includes(role);
