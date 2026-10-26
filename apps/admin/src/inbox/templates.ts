// Quick replies in the reply box (#6, C7c, N163): "/" and the start of a shortcut opens the templates of the conversation's
// workspace; a picked template comes in with the variables the Inbox knows already filled, the others get a field each. A text
// still holding a {{…}} is never sent (the API answers 422 unresolved_variable).
import type { Me } from '../me';
import type { Role } from '../nav';
import { VARIABLES } from '../quick-replies/quick-replies';
import type { WorkspaceList } from '../workspaces/workspace';

type Variable = (typeof VARIABLES)[number][0];
export type Known = Partial<Record<Variable, string>>;

/** At most this many templates under the box, most used first as the API sorts them. */
export const MAX_SHOWN = 8;

/** The start of a shortcut when the whole box is "/" and that start (lower case), else null: the picker is closed. */
export function slashQuery(text: string): string | null {
  const m = /^\/([a-z0-9_-]{0,32})$/i.exec(text);
  return m ? (m[1] ?? '').toLowerCase() : null;
}

/** What the Inbox knows of the person and the company (N163); the customer's name is not served yet, the workspace's phone see `phoneOf` (U37). */
export function knownOf(me: Pick<Me, 'name' | 'org'>): Known {
  const agent = me.name.trim();
  const company = me.org?.name.trim() ?? '';
  return { ...(agent ? { agent_name: agent } : {}), ...(company ? { company_name: company } : {}) };
}

/** Who reads `GET /v1/workspaces` (N157), so the Inbox knows {{company_phone}} for them; the other roles fill it (U37). */
export const readsWorkspaces = (role: Role): boolean => role === 'owner' || role === 'admin';

/** {{company_phone}}: the contact number of the conversation's workspace (`contactPhone`, N163), when it is set. */
export function phoneOf(list: WorkspaceList | undefined, workspaceId: string): Known {
  const phone = list?.data.find((w) => w.id === workspaceId)?.contactPhone?.trim();
  return phone ? { company_phone: phone } : {};
}

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The names between {{ and }} in `text`, in order, each once, as the API reads them. */
export const variablesIn = (text: string): string[] => [
  ...new Set([...text.matchAll(VARIABLE)].map((m) => m[1] ?? '')),
];

/** Every {{name}} with a value that is not blank replaced by it, trimmed; the others stay. */
export function fill(text: string, values: Readonly<Record<string, string | undefined>>): string {
  return text.replace(VARIABLE, (token, name: string) => values[name]?.trim() || token);
}

/** The variables of `text` the person fills in a field (those of Đợt 1), with their words. */
export function fieldsOf(text: string): { readonly name: string; readonly label: string }[] {
  const names = variablesIn(text);
  return VARIABLES.filter(([v]) => names.includes(v)).map(([name, label]) => ({ name, label }));
}

/** Why `text` (already filled) cannot be sent while a {{…}} is left, or null. */
export function unresolvedProblem(text: string): string | null {
  const left = variablesIn(text);
  if (!left.length) return null;
  const unknown = left.filter((n) => !VARIABLES.some(([v]) => v === n));
  if (unknown.length)
    return `Xóa ${unknown.map((n) => `{{${n}}}`).join(', ')} khỏi tin: biến này không điền được.`;
  const words = VARIABLES.filter(([v]) => left.includes(v)).map(([, label]) => label);
  return `Điền ${words.join(', ')} trước khi gửi.`;
}
