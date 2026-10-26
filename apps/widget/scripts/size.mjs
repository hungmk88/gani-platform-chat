/* global URL, console, process */
// apps/widget/CLAUDE.md "Ràng buộc kích thước (cứng)": loader.js < 5KB gzip, main bundle < 35KB gzip. Above them the build fails.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMITS = { 'loader.js': 5 * 1024, 'widget.js': 35 * 1024 };
let over = false;
for (const [file, limit] of Object.entries(LIMITS)) {
  const size = gzipSync(readFileSync(new URL(`../dist/${file}`, import.meta.url))).length;
  const ok = size < limit;
  over ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'OVER'} ${file}: ${(size / 1024).toFixed(2)} KB gzip (< ${limit / 1024} KB)`,
  );
}
if (over) process.exitCode = 1;
