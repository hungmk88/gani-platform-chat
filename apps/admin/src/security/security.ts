// #29 Bảo mật, Đợt 1 read only (PR A, CEO 30/10): the incidents and the alerts of the company, newest first by cursor, from
// `GET /v1/security-incidents` and `GET /v1/security-alerts`, contracts planned for S5 (N167). Until the API serves them, the routes
// answer 404 and the screen says it is not there yet. Opening, closing and handing over an incident wait for PR B (S5 final, U35 no
// longer temporary, the CEO's design of the dialogs).
import type { components } from '../api/planned';

export type SecurityAlert = components['schemas']['SecurityAlert'];
export type SecurityAlertPage = components['schemas']['SecurityAlertPage'];
export type SecurityIncident = components['schemas']['SecurityIncident'];
export type SecurityIncidentPage = components['schemas']['SecurityIncidentPage'];
export type IncidentStatus = SecurityIncident['status'];

// 50 = mặc định của hợp đồng (trần 100, cả hai đường).
const LIMIT = '50';

/** The incidents of one status: `status` is always sent (U68: what the API gives without it is not said). */
export function incidentsPath(status: IncidentStatus, cursor: string | null): string {
  const p = new URLSearchParams({ status, limit: LIMIT });
  if (cursor) p.set('cursor', cursor);
  return `/v1/security-incidents?${p.toString()}`;
}

/** Every alert, not filtered: what `open` means is asked in U68. */
export function alertsPath(cursor: string | null): string {
  const p = new URLSearchParams({ limit: LIMIT });
  if (cursor) p.set('cursor', cursor);
  return `/v1/security-alerts?${p.toString()}`;
}

/** The rows of the pages read, each once: a record put at the head between two pages shifts the next page onto rows seen. */
export function uniqueRows<T extends { readonly id: string }>(
  pages: readonly { readonly data: readonly T[] }[],
): T[] {
  const seen = new Set<string>();
  return pages.flatMap((p) => p.data).filter((r) => !seen.has(r.id) && Boolean(seen.add(r.id)));
}

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** A time of the API in Viet Nam's time, or "—" for none. */
export const timeText = (iso: string | null): string => (iso ? TIME.format(new Date(iso)) : '—');
