// #23 Dữ liệu khách, the tabs of /settings/customer-data (CEO 02/11, brief 33, 46: 23a, read only). The custom fields of the
// company are `GET /v1/customer-fields` of the contract planned for S4 (docs/openapi/planned.json, #548, N191), generated in
// src/api/planned.d.ts; the route FE guessed before the contract (`/v1/customer-field-defs`, endpoint-M8) is not used
// (docs/ui/customer-data-shape-assumptions.md). The tags are `GET /v1/tags`, real API since #559 (docs/openapi/openapi.json, N190).
// Until the API serves a route it answers 404 and its tab says it is not there yet.
import type { components } from '../api/planned';
import type { components as real } from '../api/schema';

/** The tabs of /settings/customer-data, by `?tab=` as /me (brief 33 (3)); the requests on personal data stay the first. */
export const TABS = [
  ['requests', 'Yêu cầu dữ liệu cá nhân'],
  ['fields', 'Trường tùy chỉnh'],
  ['tags', 'Tag'],
] as const;
export type Tab = (typeof TABS)[number][0];

/** The tab a URL asks for; anything else is the first one. */
export const tabOf = (raw: string | undefined): Tab =>
  TABS.find(([k]) => k === raw)?.[0] ?? 'requests';

/** A custom field of the company's customers (J1), the API gives them by `position`. */
export type CustomerField = components['schemas']['CustomerField'];

/** The seven kinds of the contract (N191), in words. */
export const FIELD_TYPE: Readonly<Record<CustomerField['type'], string>> = {
  text: 'Chữ',
  number: 'Số',
  date: 'Ngày',
  select: 'Chọn một',
  multiselect: 'Chọn nhiều',
  phone: 'Số điện thoại',
  email: 'Email',
};

export const FIELDS_PATH = '/v1/customer-fields';

/** A tag of the company's customers (J4), the API gives them by name, with how many customers carry each. */
export type Tag = real['schemas']['Tag'];
export const TAGS_PATH = '/v1/tags';

/** The choices of a select or multiselect field, as the API gives them; any other kind has none (N191). */
export const optionsText = (f: Pick<CustomerField, 'options'>) =>
  f.options.length ? f.options.join(', ') : '—';
