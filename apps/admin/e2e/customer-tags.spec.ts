import { expect, test, type Page, type Request, type Route } from '@playwright/test';

import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { TAGS } from './stub-customer-data';
import { CUSTOMERS } from './stub-customers';

// #8 Hồ sơ khách, tag (J4, N190; CEO brief 169 P2a): the customer's tags for every role, "Sửa tag" for the roles of "Sửa hồ sơ
// khách", PUT /v1/customers/{id}/tags (the whole set) saved optimistically. The tags of the company are the stub's (GET /v1/tags);
// the customer with tags and the PUT are answered here (page.route).
const AN = CUSTOMERS[0]!;
const [SI, QUAN, OLD] = TAGS.map(({ id, name, hidden }) => ({ id, name, hidden })) as [
  { id: string; name: string; hidden: boolean },
  { id: string; name: string; hidden: boolean },
  { id: string; name: string; hidden: boolean },
];
const isCustomer = (u: URL) => u.pathname === `/v1/customers/${AN.id}`;
const isPut = (u: URL) => u.pathname === `/v1/customers/${AN.id}/tags`;
const section = (page: Page) => page.getByRole('region', { name: 'Tag', exact: true });
const chips = (page: Page) => section(page).getByRole('list', { name: 'Tag của khách' });
const editor = (page: Page) => section(page).getByRole('form', { name: 'Sửa tag' });

/** The customer carries SI and the hidden OLD; each PUT is kept and answered by `answer(body)`. */
async function serve(
  page: Page,
  answer: (
    ids: string[],
  ) => Parameters<Route['fulfill']>[0] | Promise<Parameters<Route['fulfill']>[0]>,
) {
  const puts: Request[] = [];
  await page.route(isCustomer, (r) => r.fulfill({ json: { ...AN, tags: [SI, OLD] } }));
  await page.route(isPut, async (r) => {
    puts.push(r.request());
    const { tagIds } = r.request().postDataJSON() as { tagIds: string[] };
    await r.fulfill(await answer(tagIds));
  });
  return puts;
}
const kept = (ids: string[]) => ({
  json: { data: [SI, QUAN, OLD].filter((t) => ids.includes(t.id)) },
});

test('sales ticks a tag and takes the hidden one off: shown at once, then saved', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const puts = await serve(page, async (ids) => (await gate, kept(ids)));
  await signIn(page, accountOf('sales'));
  await page.goto(`/customers/${AN.id}`);
  await expect(chips(page).getByRole('listitem')).toHaveText(['Khách sỉ', 'Thử nghiệm cũ (đã ẩn)']);
  await section(page).getByRole('button', { name: 'Sửa tag' }).click();
  await expect(editor(page)).toBeFocused();
  // Every tag not hidden, and the hidden one the customer has.
  const boxes = editor(page).getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(editor(page).getByRole('checkbox', { name: 'Khách sỉ' })).toBeChecked();
  await expect(editor(page).getByRole('checkbox', { name: 'Thử nghiệm cũ (đã ẩn)' })).toBeChecked();
  await expectAccessible(page);
  await editor(page).getByRole('checkbox', { name: 'Quán ăn' }).check();
  await editor(page).getByRole('checkbox', { name: 'Thử nghiệm cũ (đã ẩn)' }).uncheck();
  await editor(page).getByRole('button', { name: 'Lưu tag' }).click();

  await expect(chips(page).getByRole('listitem')).toHaveText(['Khách sỉ', 'Quán ăn']);
  await expect(section(page).getByRole('status')).toHaveText('Đang lưu tag…');
  await expect(section(page).getByRole('button', { name: 'Sửa tag' })).toBeFocused();
  release();
  await expect(section(page).getByRole('status')).toHaveCount(0);
  await expect(chips(page).getByRole('listitem')).toHaveText(['Khách sỉ', 'Quán ăn']);
  expect(puts).toHaveLength(1);
  expect(puts[0]!.postDataJSON()).toEqual({ tagIds: [SI.id, QUAN.id] });
  expect(puts[0]!.headers()['idempotency-key']).toBeUndefined();
});

test('a refusal puts the old tags back and opens the boxes again as ticked, its sentence focused', async ({
  page,
}) => {
  const problem = (status: number, code: string) => ({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ status, code, traceId: `trace-${code}` }),
  });
  let n = 0;
  const tagReads: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/tags') tagReads.push(r.url());
  });
  await serve(page, () =>
    ++n === 1 ? problem(500, 'internal_error') : problem(422, 'tag_hidden'),
  );
  await signIn(page, accountOf('manager'));
  await page.goto(`/customers/${AN.id}`);
  await section(page).getByRole('button', { name: 'Sửa tag' }).click();
  await editor(page).getByRole('checkbox', { name: 'Quán ăn' }).check();
  await editor(page).getByRole('button', { name: 'Lưu tag' }).click();
  // A 500 reads nothing again: the old set is put back by the screen itself.
  const alert = editor(page).getByRole('alert');
  await expect(alert).toContainText('Mã: trace-internal_error');
  await expect(alert).toBeFocused();
  await expect(editor(page).getByRole('checkbox', { name: 'Quán ăn' })).toBeChecked();
  await expect(chips(page).getByRole('listitem')).toHaveText(['Khách sỉ', 'Thử nghiệm cũ (đã ẩn)']);
  const before = tagReads.length;
  // A tag hidden meanwhile: said, and the list of tags read again.
  await editor(page).getByRole('button', { name: 'Lưu tag' }).click();
  await expect(alert).toContainText('Có tag vừa bị ẩn, không gắn mới được.');
  await expect(alert).toContainText('Mã: trace-tag_hidden');
  await expect.poll(() => tagReads.length).toBeGreaterThan(before);
  await editor(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(section(page).getByRole('button', { name: 'Sửa tag' })).toBeFocused();
});

test('nothing changed: Lưu tag closes and sends nothing', async ({ page }) => {
  const puts = await serve(page, kept);
  await signIn(page, accountOf('owner'));
  await page.goto(`/customers/${AN.id}`);
  await section(page).getByRole('button', { name: 'Sửa tag' }).click();
  await expect(editor(page).getByRole('checkbox')).toHaveCount(3);
  await editor(page).getByRole('button', { name: 'Lưu tag' }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(puts).toHaveLength(0);
});

for (const role of ['viewer', 'marketing'] as const)
  test(`a ${role} reads the tags, changes nothing and never reads the company's`, async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/v1/tags') asked.push(r.url());
    });
    await serve(page, kept);
    await signIn(page, accountOf(role));
    await page.goto(`/customers/${AN.id}`);
    await expect(chips(page).getByRole('listitem')).toHaveCount(2);
    await expect(section(page).getByRole('button', { name: 'Sửa tag' })).toHaveCount(0);
    expect(asked).toEqual([]);
  });

test('a customer without tags says so', async ({ page }) => {
  await signIn(page, accountOf('support'));
  await page.goto(`/customers/${AN.id}`);
  await expect(section(page)).toContainText('Khách chưa có tag nào.');
  await expect(section(page).getByRole('button', { name: 'Sửa tag' })).toBeVisible();
});
