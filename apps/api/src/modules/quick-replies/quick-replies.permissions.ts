import type { OrgRole } from '@gani/db';

// Phụ lục B: "Quản lý mẫu trả lời nhanh" is Owner, Admin, Manager (U20-5); every role that answers customers in the Inbox ("Trả lời
// khách, ghi chú nội bộ": Owner, Admin, Manager, Sales, Support) reads the templates to use them.
const WRITERS: readonly OrgRole[] = ['owner', 'admin', 'manager'];
const READERS: readonly OrgRole[] = [...WRITERS, 'sales', 'support'];

export const mayReadQuickReplies = (role: OrgRole): boolean => READERS.includes(role);
export const mayWriteQuickReplies = (role: OrgRole): boolean => WRITERS.includes(role);
