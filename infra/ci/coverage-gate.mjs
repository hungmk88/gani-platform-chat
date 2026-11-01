#!/usr/bin/env node
// The per-file coverage gate of the CI job `coverage` (infra/CLAUDE.md "Coverage"). Reads every coverage-final.json under the given
// directories (the unit runs of `verify`, the integration runs of `db` and `queue`), merges them per file and fails when a file of the
// backend is under the threshold, unless it is listed below. Usage: node infra/ci/coverage-gate.mjs <dir>...
//
// Merged by location, not by index: a statement or a branch counts as covered when any run hit the same place of the source. Two runs
// may number the statements of one file differently; their locations stay the same (the merge of the review of 30/10, #423).
// Node only, no dependency: the job does not install the workspace.
import console from 'node:console';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const THRESHOLD = { lines: 80, branches: 70 };

// The backend: what the review of 30/10 measured. The admin, the widget and packages/ui belong to the FE.
export const PACKAGES = [
  'apps/api',
  'apps/worker',
  'packages/ai-core',
  'packages/db',
  'packages/domain',
  'packages/conversations',
  'packages/channels',
  'packages/email',
];

const SCHEMA = 'pgTable callback (primary key, indexes): only the migration tooling calls it';
const CHILD = 'runs in a child process that the spec starts; v8 does not collect it';
// Below the threshold on purpose, never a debt (approved 30/10).
export const EXEMPT = {
  'packages/db/src/schema/audit-logs.ts': SCHEMA,
  'packages/db/src/schema/conversation-events.ts': SCHEMA,
  'packages/db/src/schema/idempotency-keys.ts': SCHEMA,
  'packages/db/src/schema/inbound-event-keys.ts': SCHEMA,
  'packages/db/src/schema/inbound-events.ts': SCHEMA,
  'packages/db/src/schema/messages.ts': SCHEMA,
  'packages/db/src/schema/outbox-events.ts': SCHEMA,
  'packages/db/src/schema/platform-access-logs.ts': SCHEMA,
  'apps/api/src/modules/auth/testing/totp.ts': 'a tool of the tests, not code that runs',
  'apps/worker/src/ops/create-org.ts': CHILD,
  'apps/worker/src/ops/create-workspace.ts': CHILD,
};

// Missing tests, to be written before S4 (28/12), issue #433. A file leaves this list once it meets the threshold, and the gate fails until it is
// removed, so the list only gets shorter. Adding a file needs a comment in its pull request saying why (infra/CLAUDE.md "Coverage").
export const DEBT = {
  'packages/db/src/customer-store.ts': 'lines 86, branches 50',
  'packages/db/src/quick-reply-store.ts': 'lines 84, branches 67',
  'apps/api/src/modules/members/invite-mailer.ts': 'lines 100, branches 50',
  'apps/api/src/modules/teams/teams.schemas.ts': 'lines 100, branches 50',
  'packages/db/src/audit-log.ts': 'lines 100, branches 50',
  'packages/email/src/smtp-sender.ts': 'lines 100, branches 67',
  'packages/conversations/src/errors.ts': 'lines 77.5, branches 100',
};

const where = (loc) => `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
const inScope = (file) => PACKAGES.some((p) => file.startsWith(`${p}/src/`));

/** Merges istanbul reports (coverage-final.json objects) into hits per location, for the files of the backend under `root`. */
export function merge(reports, root) {
  const files = new Map();
  for (const report of reports) {
    for (const [path, data] of Object.entries(report)) {
      const file = relative(root, path).split(sep).join('/');
      if (!inScope(file)) continue;
      const hits = files.get(file) ?? { statements: new Map(), branches: new Map() };
      files.set(file, hits);
      for (const [id, loc] of Object.entries(data.statementMap)) {
        const k = where(loc);
        hits.statements.set(k, {
          line: loc.start.line,
          n: (hits.statements.get(k)?.n ?? 0) + data.s[id],
        });
      }
      for (const [id, branch] of Object.entries(data.branchMap)) {
        data.b[id].forEach((n, arm) => {
          const k = `${where(branch.loc ?? branch.locations[arm])}#${arm}`;
          hits.branches.set(k, (hits.branches.get(k) ?? 0) + n);
        });
      }
    }
  }
  return files;
}

const percent = (covered, total) => (total === 0 ? 100 : (100 * covered) / total);

/** Lines (a line is covered when a statement starting on it ran) and branches, in percent. */
export function measure(hits) {
  const lines = new Map();
  for (const { line, n } of hits.statements.values())
    lines.set(line, Math.max(lines.get(line) ?? 0, n));
  const covered = (values) => [...values].filter((n) => n > 0).length;
  return {
    lines: percent(covered(lines.values()), lines.size),
    branches: percent(covered(hits.branches.values()), hits.branches.size),
  };
}

/** What fails the gate, as sentences; empty when it passes. */
export function judge(files, exempt = EXEMPT, debt = DEBT) {
  const failures = [];
  const show = ({ lines, branches }) =>
    `lines ${lines.toFixed(1)}, branches ${branches.toFixed(1)}`;
  for (const pkg of PACKAGES) {
    if (![...files.keys()].some((f) => f.startsWith(`${pkg}/src/`)))
      failures.push(`${pkg}: no file measured (a coverage report is missing)`);
  }
  for (const [file, hits] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const m = measure(hits);
    const below = m.lines < THRESHOLD.lines || m.branches < THRESHOLD.branches;
    if (file in exempt) continue;
    if (file in debt && !below)
      failures.push(`${file}: ${show(m)} meets the threshold now, remove it from DEBT`);
    else if (!(file in debt) && below) failures.push(`${file}: ${show(m)}`);
  }
  for (const file of [...Object.keys(exempt), ...Object.keys(debt)]) {
    if (!files.has(file)) failures.push(`${file}: listed but not measured (renamed or deleted?)`);
  }
  return failures;
}

function reportsUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.split(sep).at(-1) === 'coverage-final.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dirs = process.argv.slice(2);
  const reports = dirs.flatMap(reportsUnder);
  const files = merge(reports, process.cwd());
  const failures = judge(files);
  console.log(
    `coverage-gate: ${reports.length} reports, ${files.size} files; per file lines >= ${THRESHOLD.lines}, branches >= ${THRESHOLD.branches}`,
  );
  console.log(
    `coverage-gate: ${Object.keys(EXEMPT).length} exempt, ${Object.keys(DEBT).length} in debt`,
  );
  for (const f of failures) console.log(`FAIL ${f}`);
  if (reports.length === 0 || failures.length > 0) {
    console.log('coverage-gate: ĐỎ');
    process.exit(1);
  }
  console.log('coverage-gate: đạt');
}
