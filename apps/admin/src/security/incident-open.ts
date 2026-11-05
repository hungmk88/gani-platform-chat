// #29 PR B1 "Mở sự cố" (CEO 05/11, brief 61, tầng 2): `POST /v1/security-incidents` planned S5 (Idempotency-Key), audited by the
// API (`security.incident_opened`). The contract takes a title, a severity and who handles it; no description (brief 61: the box
// is dropped) and the alerts it covers wait for after B1.
import type { components } from '../api/planned';
import type { Member } from '../members/list';
import { SEVERITY, type Severity } from './labels';

export type IncidentCreate = components['schemas']['SecurityIncidentCreate'];

export const MAX_TITLE = 200;

/** The four severities of the contract, lowest first, in their words (brief 61: "Thấp" included). */
export const SEVERITIES = Object.keys(SEVERITY) as Severity[];

/** As prototype/dot1/security.js: a phone number or an e-mail address in the title, which is audited and sent in alerts. */
const PII = /(\+?84|0)\d{9}\b|[^@\s]+@[^@\s]+\.[^@\s]+/;

/** Why the title cannot be sent, or null: 1–200 characters once trimmed, no phone or e-mail. */
export function titleProblem(raw: string): string | null {
  const title = raw.trim();
  if (!title) return 'Ghi tên sự cố.';
  if (title.length > MAX_TITLE) return `Tên sự cố tối đa ${MAX_TITLE} ký tự.`;
  if (PII.test(title)) return 'Bỏ SĐT, email khỏi tên sự cố: sự cố được ghi audit và gửi cảnh báo.';
  return null;
}

/** Who may handle it, as the API takes (422 `invalid_handler` otherwise): an active Owner or Admin, by name. */
export function handlersOf(members: readonly Member[]): { userId: string; label: string }[] {
  return members
    .filter((m) => m.status === 'active' && m.userId && (m.role === 'owner' || m.role === 'admin'))
    .map((m) => ({
      userId: m.userId as string,
      label: `${m.name ?? m.email} · ${m.role === 'owner' ? 'Owner' : 'Admin'}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

/** The body of the POST: the title trimmed, the severity and the handler chosen. */
export const incidentBodyOf = (title: string, severity: Severity, handlerUserId: string): IncidentCreate => ({
  title: title.trim(),
  severity,
  handlerUserId,
});
