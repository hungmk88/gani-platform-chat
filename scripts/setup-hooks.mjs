// Runs on `pnpm install` (root "prepare"): point git at the repo's .githooks directory.
// Silent no-op when git or a .git directory is missing (Docker builds, source tarballs).
import { spawnSync } from 'node:child_process';

const git = (...args) => spawnSync('git', args, { stdio: 'ignore' });

try {
  if (git('rev-parse', '--git-dir').status === 0) {
    git('config', 'core.hooksPath', '.githooks');
  }
} catch {
  // Never fail an install because of hook setup.
}
