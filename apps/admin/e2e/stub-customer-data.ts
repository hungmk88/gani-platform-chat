// #23 Dữ liệu khách, tab "Trường tùy chỉnh", for the e2e stub API only, on the contract planned for S4 (docs/openapi/planned.json,
// #548, N191; src/customer-data/catalog.ts): `GET /v1/customer-fields`, the company's fields by `position`, hidden ones too.
// Every role of the company reads them (N191). Empty lists, errors and the 404 of an API that does not serve the route yet are
// given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CustomerField } from '../src/customer-data/catalog';
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

/** Answers the read of the tab and says true, or says false for any other route. `session` is null when signed out. */
export function routeCustomerData(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/customer-fields') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (!session.role || session.role === 'platform_operator')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  return (edge.send(res, 200, { data: FIELDS }), true);
}
