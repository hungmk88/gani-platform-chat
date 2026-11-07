// #8 Hồ sơ khách, tag của khách (J4, N190; CEO brief 169 P2a): the tags offered to a customer and what a refused change says. Every
// role reads a customer's tags (in `Customer`); the roles of "Sửa hồ sơ khách" set them whole (`PUT /v1/customers/{id}/tags`). A
// hidden tag is never given again (422 tag_hidden), one the customer has stays until taken off (T-4).
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Tag } from '../customer-data/catalog';

export type CustomerTag = components['schemas']['CustomerTag'];
export type CustomerTagList = components['schemas']['CustomerTags'];

export const tagsPath = (id: string): string => `/v1/customers/${encodeURIComponent(id)}/tags`;

/** The tags a customer may carry, by name: every tag not hidden, and the hidden ones they already have. */
export function tagChoices(all: readonly Tag[], has: readonly CustomerTag[]): CustomerTag[] {
  const mine = new Set(has.map((t) => t.id));
  const shown = all
    .filter((t) => !t.hidden || mine.has(t.id))
    .map(({ id, name, hidden }) => ({ id, name, hidden }));
  // One they have that the list no longer gives (merged meanwhile) still shows, to be taken off.
  const known = new Set(shown.map((t) => t.id));
  return [...shown, ...has.filter((t) => !known.has(t.id))].sort((a, b) =>
    a.name.localeCompare(b.name, 'vi'),
  );
}

/** The customer's tags as they will be once `chosen` is saved, by name, for the profile meanwhile. */
export const chosenTags = (choices: readonly CustomerTag[], chosen: ReadonlySet<string>) =>
  choices.filter((t) => chosen.has(t.id));

/** What a refused change says; `again`: the list of tags and the customer are read again. */
export function tagFailureOf(e: Pick<ApiError, 'code' | 'message'>): {
  readonly text: string;
  readonly again: boolean;
} {
  if (e.code === 'tag_hidden')
    return { text: 'Có tag vừa bị ẩn, không gắn mới được. Danh sách tag đã tải lại.', again: true };
  if (e.code === 'not_found')
    return {
      text: 'Có tag hoặc khách không còn (đã gộp hoặc đã xóa). Danh sách tag đã tải lại.',
      again: true,
    };
  return { text: e.message, again: false };
}
