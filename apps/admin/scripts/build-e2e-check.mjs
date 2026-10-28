/* global console, process */
// `pnpm build:e2e-check` (#378): `next build` of the admin as the CI job "admin (e2e, axe)" runs it, where only the admin's own
// dependencies are built (`pnpm --filter "@gani/admin..." build`). Every other package's dist/ is moved aside for the build and
// put back after, even when the build fails or is stopped; a dist left aside by a killed run is put back first.
import { renameSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const ASIDE = '.dist-e2e-check';
const sh = { shell: process.platform === 'win32', encoding: 'utf8' };

const listed = spawnSync(
  'pnpm',
  ['--filter', '@gani/admin...', 'ls', '--depth', '-1', '--json'],
  sh,
);
if (listed.status !== 0) throw new Error(`pnpm ls failed: ${listed.stderr}`);
const needed = new Set(JSON.parse(listed.stdout).map((p) => resolve(p.path)));

const packages = readdirSync(join(root, 'packages')).map((d) => join(root, 'packages', d));
for (const p of packages)
  if (existsSync(join(p, ASIDE))) renameSync(join(p, ASIDE), join(p, 'dist'));
const moved = packages.filter((p) => !needed.has(p) && existsSync(join(p, 'dist')));
const putBack = () => {
  for (const p of moved)
    if (existsSync(join(p, ASIDE))) renameSync(join(p, ASIDE), join(p, 'dist'));
};
process.on('SIGINT', () => (putBack(), process.exit(130)));

let status;
try {
  for (const p of moved) renameSync(join(p, 'dist'), join(p, ASIDE));
  console.log(
    `dist/ moved aside: ${moved.map((p) => p.slice(root.length + 1)).join(', ') || 'none'}`,
  );
  const env = { ...process.env };
  delete env.NODE_ENV; // next build breaks with NODE_ENV=development (apps/admin/CLAUDE.md)
  status =
    spawnSync('pnpm', ['build'], { ...sh, cwd: join(root, 'apps/admin'), env, stdio: 'inherit' })
      .status ?? 1;
} finally {
  putBack();
}
process.exit(status);
