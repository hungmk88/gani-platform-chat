// #23 Dữ liệu khách, tabs "Trường tùy chỉnh" and "Tag", for the e2e stub API only (src/customer-data/catalog.ts):
// `GET /v1/customer-fields` (planned S4, #548, N191), the company's fields by `position`, and `GET /v1/tags` (real API, #559,
// N190), its tags by name, hidden ones too. Every role of the company reads them. Empty lists, errors and the 404 of an API that does not serve the route yet are
// given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CustomerField, Tag } from '../src/customer-data/catalog';
import type { Edge } from './stub-members';

const id = (n: number) => `0190e500-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const field = (
  n: number,
  name: string,
  type: CustomerField['type'],
  more: Partial<CustomerField> = {},
): CustomerField => ({
  id: id(n),
  name,
  type,
  options: [],
  required: false,
  sensitive: false,
  hidden: false,
  position: n - 1,
  hasData: false,
  createdAt: '2026-10-20T03:00:00.000Z',
  updatedAt: '2026-10-20T03:00:00.000Z',
  ...more,
});

/** One field of each of the seven kinds (brief 36 (3)): one required, one sensitive, one hidden, two with choices, some with data. */
export const FIELDS: readonly CustomerField[] = [
  field(1, 'Tên quán', 'text', { required: true, hasData: true }),
  field(2, 'Sản lượng/tháng', 'number'),
  field(3, 'Ngày khai trương', 'date'),
  field(4, 'Kênh biết đến', 'select', { options: ['Zalo', 'Hội chợ'], hidden: true }),
  field(5, 'Sản phẩm quan tâm', 'multiselect', { options: ['Phở khô', 'Bún', 'Miến'] }),
  field(6, 'SĐT kế toán', 'phone', { sensitive: true, hasData: true }),
  field(7, 'Email hóa đơn', 'email'),
];

const tag = (n: number, name: string, customerCount: number, hidden = false): Tag => ({
  id: id(n),
  name,
  hidden,
  customerCount,
  createdAt: '2026-10-20T03:00:00.000Z',
  updatedAt: '2026-10-20T03:00:00.000Z',
});
/** The tags of the company, by name; one hidden that no customer carries. */
export const TAGS: readonly Tag[] = [
  tag(8, 'Khách sỉ', 12),
  tag(9, 'Quán ăn', 30),
  tag(10, 'Thử nghiệm cũ', 0, true),
];

/** Answers the reads of the tabs and says true, or says false for any other route. `session` is null when signed out. */
export function routeCustomerData(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || (path !== '/v1/customer-fields' && path !== '/v1/tags')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!session.role || session.role === 'platform_operator')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  return (edge.send(res, 200, { data: path === '/v1/tags' ? TAGS : FIELDS }), true);
}
