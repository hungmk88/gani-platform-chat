/* global process, console */
/* Dùng chung cho smoke-*.mjs: mở trang prototype trong Chromium, ghi lỗi trang, kiểm tra, chụp ảnh. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.PROTOTYPE_DIR || path.resolve(here, '../dot1');
const shotsDir = process.env.SHOTS_DIR || null;

export const ROLES = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer', 'platform_operator'];

export async function createRunner() {
  // CHROMIUM_PATH: Chromium có sẵn trên máy; bỏ trống thì playwright-core dùng bản nó tự tìm.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const problems = [];
  let dialogs = 0;

  async function open(page, viewport = { width: 1440, height: 900 }) {
    const p = await browser.newPage({ viewport });
    p.on('pageerror', (e) => problems.push(`${page}: pageerror ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && problems.push(`${page}: console ${m.text()}`));
    p.on('dialog', async (d) => {
      dialogs += 1;
      await d.dismiss();
    });
    await p.goto(`file://${root}/${page}`);
    await p.waitForTimeout(150);
    return p;
  }

  function check(cond, msg) {
    if (cond) console.log(`ok   ${msg}`);
    else problems.push(`FAIL ${msg}`);
  }

  async function shot(p, name, fullPage = false) {
    if (shotsDir) await p.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage });
  }

  /* Mở mọi trạng thái × 8 vai trò của từng trang: chỉ bắt lỗi trang (pageerror, console.error). */
  async function renderAll(states) {
    for (const [file, list] of Object.entries(states)) {
      for (const s of list) {
        for (const r of ROLES) {
          const p = await open(`${file}${file.includes('?') ? '&' : '?'}state=${s}&role=${r}`);
          await p.close();
        }
      }
    }
    console.log(`ok   rendered ${Object.keys(states).length} pages × states × 8 roles`);
  }

  async function finish() {
    check(dialogs === 0, 'không có alert() nào chạy (T2)');
    await browser.close();
    console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join('\n')}` : '\nNo problems.');
    process.exit(problems.length ? 1 : 0);
  }

  return { open, check, shot, renderAll, finish };
}
