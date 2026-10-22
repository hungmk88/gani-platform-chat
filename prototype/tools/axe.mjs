/* global process, console, window, document */
/* Kiểm tra trợ năng WCAG 2.1 A/AA bằng axe-core trên các màn và trạng thái chính của prototype.
   Thoát 1 nếu có vi phạm. Chạy: xem README.md. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.PROTOTYPE_DIR || path.resolve(here, '../dot1');
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const PAGES = [
  'index.html',
  'inbox.html?role=sales',
  'inbox.html?role=manager&state=aioff',
  'inbox.html?role=sales&state=api_closed',
  'customer.html?role=sales',
  'customer.html?role=manager&state=merge',
  'leads.html?role=sales',
  'leads.html?role=sales&terminal=B',
  'bots.html?role=admin',
  'bots.html?role=admin&state=config_error',
  'login.html?role=sales&state=error',
  'invite.html?role=admin',
  'invite.html?role=sales&state=used',
  'me.html?role=sales',
  'me.html?role=admin&tab=security',
  'me.html?role=sales&tab=security&state=tfa_on',
  'me.html?role=sales&tab=notify',
  'system.html?role=sales&state=error',
  'customer.html?role=platform_operator&shell=platform_session',
  'inbox.html?role=sales&shell=auto_offline',
  'inbox.html?role=sales&shell=switching',
  'twofa.html?role=admin',
  'twofa.html?role=admin&state=wrong',
  'twofa.html?role=admin&state=locked',
  'twofa.html?role=admin&state=backup',
  'twofa.html?role=owner&state=enroll_required',
  'twofa.html?role=admin&state=reset_by_admin',
  'leads.html?role=sales&state=drawer',
  'leads.html?role=support&state=drawer',
  'inbox.html?role=sales&state=after_hours',
  'reset.html?role=sales',
  'reset.html?role=sales&state=sent',
  'reset.html?role=sales&state=weak',
  'reset.html?role=sales&state=expired',
  'login.html?role=sales&state=aioff',
  'members.html?role=admin',
  'members.html?role=admin&state=invite_expired',
  'teams.html?role=admin',
  'teams.html?role=manager',
  'teams.html?role=admin&state=empty',
  'quick-replies.html?role=manager',
  'quick-replies.html?role=admin&state=empty',
  'customers.html?role=manager',
  'customers.html?role=marketing&state=aioff',
  'privacy.html?role=admin',
  'privacy.html?role=owner&state=empty',
  'customer-import.html?role=admin',
  'customer-import.html?role=admin&step=2',
  'customer-import.html?role=admin&step=3',
  'customer-data.html?role=admin',
  'customer-data.html?role=admin&tab=tags',
  'customer-data.html?role=manager&state=aioff',
  'workspace.html?role=admin',
  'workspace.html?role=admin&tab=sla',
  'workspace.html?role=admin&tab=allocation',
  'workspace.html?role=manager&tab=sla',
  'channels.html?role=admin',
  'channels.html?role=admin&state=disconnected',
  'channels.html?role=admin&screen=detail',
  'channels.html?role=admin&screen=detail&state=token_expiring',
  'channels.html?role=admin&screen=detail&state=disconnected',
  'tickets.html?role=support',
  'tickets.html?role=support&state=drawer',
  'tickets.html?role=sales&state=drawer',
  'tickets.html?role=support&state=empty',
  'audit.html?role=admin',
  'audit.html?role=admin&tab=access',
  'platform.html?role=platform_operator',
  'platform.html?role=platform_operator&tab=access',
  'platform.html?role=platform_operator&tab=policies',
  'overview.html?role=manager',
  'overview.html?role=sales',
  'overview.html?role=manager&state=aioff',
  'autonomy.html?role=owner',
  'autonomy.html?role=admin',
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const summary = {};
for (const page of PAGES) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`file://${root}/${page}`);
  await p.waitForTimeout(200);
  await p.addScriptTag({ path: axePath });
  const r = await p.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
  console.log(`${r.violations.length ? 'FAIL' : 'ok  '} ${page}: ${r.violations.length} loại vi phạm`);
  for (const v of r.violations) {
    console.log(`  - [${v.impact}] ${v.id} (${v.nodes.length} nút): ${v.help} · vd: ${v.nodes[0].target.join(' ')}`);
    summary[v.id] = (summary[v.id] || 0) + v.nodes.length;
  }
  await p.close();
}
await browser.close();
const total = Object.values(summary).reduce((a, b) => a + b, 0);
console.log(`\n${PAGES.length} trang · ${total} nút vi phạm${total ? ` · theo luật: ${JSON.stringify(summary)}` : ''}`);
process.exit(total ? 1 : 0);
