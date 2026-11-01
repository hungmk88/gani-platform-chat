import { expect, test, type Page } from '@playwright/test';

import type { BotFlowDetail } from '../src/bots/bot-flows';
import { NODE_TYPE } from '../src/bots/graph';
import { expectAccessible } from './axe';
import { signIn } from './sign-in';
import { accountOf } from './stub-api';
import { BOT_FLOWS } from './stub-bot-flows';

// #17 part B (CEO 01/11): the steps of a flow on its detail, read only, a list and no canvas; the published version or the draft
// by `?ban=`. Each step is focusable and its lines link the next steps.
type Graph = BotFlowDetail['draft']['graph'];
const steps = (page: Page) => page.getByRole('main').getByRole('article');
const open = async (page: Page, path: string) => {
  await signIn(page, accountOf('manager'));
  await page.goto(path);
};
/** The flow "Hỏi giá sỉ" answered with `graph` as its only version, the draft. */
const withDraft = (page: Page, graph: Graph) =>
  page.route(`**/v1/bot-flows/${BOT_FLOWS[2]!.id}`, (r) =>
    r.fulfill({
      json: {
        ...BOT_FLOWS[2]!,
        published: null,
        draft: { id: 'v', status: 'draft', version: null, publishedAt: null, graph },
      } satisfies BotFlowDetail,
    }),
  );

test('the version published last by default, the draft by its link; the keyboard goes step by step', async ({
  page,
}) => {
  await open(page, `/bots/${BOT_FLOWS[0]!.id}`);
  await expect(page.getByRole('link', { name: 'Bản đã xuất bản' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(steps(page).getByRole('heading')).toHaveText([
    'Bước 1: Bắt đầu start',
    'Bước 2: Gửi tin hello',
    'Bước 3: Kết thúc done',
  ]);
  await expect(steps(page).nth(1)).toContainText('Nội dungChào anh/chị, Gani Foods xin nghe.');
  await page.getByRole('link', { name: 'Bản nháp' }).click();
  await expect(page).toHaveURL(/\?ban=nhap$/);
  await expect(steps(page)).toHaveCount(4);
  await page.getByRole('link', { name: 'Bản nháp' }).focus();
  await page.keyboard.press('Tab');
  await expect(steps(page).nth(0)).toBeFocused();
  await steps(page).nth(1).getByRole('link', { name: 'Bước 4 (Hỏi thêm)' }).click();
  await expect(page).toHaveURL(/#buoc-need$/);
  await expect(steps(page).nth(3)).toContainText('Lưu vào biếnneed');
  await expectAccessible(page);
});

test('a flow never published has only its draft, said empty', async ({ page }) => {
  await open(page, `/bots/${BOT_FLOWS[2]!.id}?ban=xuat-ban`);
  await expect(page.getByText('Bản này chưa có bước nào.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bản nháp' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Bản đã xuất bản' })).toHaveCount(0);
  await expect(steps(page)).toHaveCount(0);
});

test('the 12 kinds of step in words; a jump links a listed flow only; a condition is JSON', async ({
  page,
}) => {
  const unknown = '0190f200-0000-7000-8000-000000000099';
  await withDraft(page, {
    nodes: [
      { key: 'start', type: 'trigger', config: { on: 'keyword', keywords: ['giá sỉ'] } },
      { key: 'hi', type: 'message', config: { text: 'Chào <b>anh</b>' } },
      { key: 'ask', type: 'question', config: { text: 'Cần gì?', kind: 'text', variable: 'need' } },
      { key: 'check', type: 'condition', config: { expression: { eq: ['need', 'giá'] } } },
      { key: 'set', type: 'set_variable', config: { variable: 'vip', value: true } },
      { key: 'get', type: 'collect', config: { field: 'phone' } },
      { key: 'tag', type: 'tag', config: { tag: 'Khách sỉ' } },
      { key: 'call', type: 'api_call', config: { tool: 'tra_khach_theo_sdt' } },
      { key: 'wait', type: 'delay', config: { seconds: 60 } },
      { key: 'human', type: 'handoff', config: { reason: 'Hỏi giá sỉ', priority: 'high' } },
      { key: 'go', type: 'jump_to_flow', config: { flowId: BOT_FLOWS[1]!.id } },
      { key: 'away', type: 'jump_to_flow', config: { flowId: unknown } },
      { key: 'done', type: 'end', config: {} },
    ],
    edges: [
      ...['start>hi', 'hi>ask', 'ask>check', 'set>get', 'get>tag', 'tag>call', 'call>wait']
        .concat(['wait>human', 'human>go', 'go>done'])
        .map((p) => ({ from: p.split('>')[0]!, to: p.split('>')[1]!, label: null })),
      { from: 'check', to: 'set', label: 'Có' },
      { from: 'check', to: 'away', label: 'Không' },
    ],
  });
  await open(page, `/bots/${BOT_FLOWS[2]!.id}`);
  await expect(steps(page)).toHaveCount(13);
  for (const label of Object.values(NODE_TYPE))
    await expect(
      steps(page)
        .getByRole('heading', { name: new RegExp(`^Bước \\d+: ${label} `) })
        .first(),
    ).toBeVisible();
  await expect(steps(page).nth(1)).toContainText('Chào <b>anh</b>');
  await expect(steps(page).nth(3).locator('code')).toHaveText(['check', '{"eq":["need","giá"]}']);
  await expect(steps(page).nth(3)).toContainText('Tiếp theo:Bước 5 (Có)Bước 6 (Không)');
  await expect(page.getByRole('link', { name: 'Ngoài giờ' })).toHaveAttribute(
    'href',
    `/bots/${BOT_FLOWS[1]!.id}`,
  );
  await expect(page.getByTitle(unknown)).toHaveText('…00000099');
  await expectAccessible(page);
});

test('200 steps are listed in order, the last one reached by its line', async ({ page }) => {
  const key = (i: number) => `n${i}`;
  await withDraft(page, {
    nodes: Array.from({ length: 200 }, (_, i) =>
      i === 0
        ? { key: key(i), type: 'trigger' as const, config: { on: 'first_message' as const } }
        : i === 199
          ? { key: key(i), type: 'end' as const, config: {} }
          : { key: key(i), type: 'message' as const, config: { text: `Tin ${i}` } },
    ),
    edges: Array.from({ length: 199 }, (_, i) => ({ from: key(i), to: key(i + 1), label: null })),
  });
  await open(page, `/bots/${BOT_FLOWS[2]!.id}`);
  await expect(steps(page)).toHaveCount(200);
  await expect(steps(page).nth(199).getByRole('heading')).toHaveText('Bước 200: Kết thúc n199');
  await steps(page).nth(198).getByRole('link', { name: 'Bước 200' }).click();
  await expect(page).toHaveURL(/#buoc-n199$/);
});
