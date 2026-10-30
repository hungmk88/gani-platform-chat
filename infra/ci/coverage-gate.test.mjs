// Tests of infra/ci/coverage-gate.mjs, run by the CI job `coverage` before the gate itself. Usage: node --test infra/ci/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEBT, EXEMPT, PACKAGES, judge, measure, merge } from './coverage-gate.mjs';

const ROOT = '/repo';
const at = (line, from = 0, to = 10) => ({
  start: { line, column: from },
  end: { line, column: to },
});
// A coverage-final.json entry: `statements` are [line, hits]; `branches` are [line, [hits per arm]].
function entry(file, statements, branches = []) {
  const data = { statementMap: {}, s: {}, branchMap: {}, b: {} };
  statements.forEach(([line, n], i) => {
    data.statementMap[i] = at(line);
    data.s[i] = n;
  });
  branches.forEach(([line, arms], i) => {
    data.branchMap[i] = { loc: at(line, 0, 5), locations: arms.map(() => at(line, 0, 5)) };
    data.b[i] = arms;
  });
  return { [`${ROOT}/${file}`]: data };
}
// One fully covered file in every package, so "no file measured" stays out of the cases that are not about it.
const others = Object.assign({}, ...PACKAGES.map((p) => entry(`${p}/src/ok.ts`, [[1, 1]])));
const gate = (reports, exempt = {}, debt = {}) =>
  judge(merge([others, ...reports], ROOT), exempt, debt);
const of = (reports, file) => measure(merge(reports, ROOT).get(file));

test('a statement covered by either run counts once: unit and integration merge per file', () => {
  const unit = entry('packages/db/src/a.ts', [
    [1, 1],
    [2, 0],
  ]);
  const integration = entry('packages/db/src/a.ts', [
    [1, 0],
    [2, 3],
  ]);
  assert.deepEqual(of([unit], 'packages/db/src/a.ts'), { lines: 50, branches: 100 });
  assert.deepEqual(of([unit, integration], 'packages/db/src/a.ts'), { lines: 100, branches: 100 });
});

test('runs that number the statements differently still merge by location', () => {
  const one = entry('packages/db/src/a.ts', [
    [1, 1],
    [2, 0],
  ]);
  const two = entry('packages/db/src/a.ts', [
    [2, 1],
    [1, 0],
  ]);
  assert.deepEqual(of([one, two], 'packages/db/src/a.ts').lines, 100);
});

test('branches: each arm counts, merged across runs; a file without branches is 100', () => {
  const one = entry('packages/db/src/a.ts', [[1, 1]], [[1, [1, 0]]]);
  const two = entry('packages/db/src/a.ts', [[1, 1]], [[1, [0, 1]]]);
  assert.equal(of([one], 'packages/db/src/a.ts').branches, 50);
  assert.equal(of([one, two], 'packages/db/src/a.ts').branches, 100);
});

test('fails a file under 80 % of lines, or under 70 % of branches; passes one exactly at both', () => {
  // `hit` of `total` lines ran.
  const lines = (hit, total) => Array.from({ length: total }, (_, i) => [i + 1, i < hit ? 1 : 0]);
  const lines79 = entry('apps/api/src/l.ts', lines(79, 100));
  const branches = entry('apps/api/src/b.ts', [[1, 1]], [[1, [1, 1, 0, 0]]]);
  const exact = entry('apps/api/src/e.ts', lines(8, 10), [[1, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0]]]);
  assert.deepEqual(gate([lines79, branches, exact]), [
    'apps/api/src/b.ts: lines 100.0, branches 50.0',
    'apps/api/src/l.ts: lines 79.0, branches 100.0',
  ]);
});

test('ignores files outside the backend and outside src/', () => {
  const out = [entry('apps/admin/src/x.ts', [[1, 0]]), entry('packages/db/test/x.ts', [[1, 0]])];
  assert.deepEqual(gate(out), []);
});

test('an exempt file never fails; a file in debt fails only once it meets the threshold', () => {
  const low = entry('packages/db/src/low.ts', [[1, 0]]);
  const fixed = entry('packages/db/src/fixed.ts', [[1, 1]]);
  assert.deepEqual(gate([low], { 'packages/db/src/low.ts': 'why' }), []);
  assert.deepEqual(gate([low], {}, { 'packages/db/src/low.ts': 'lines 0' }), []);
  assert.deepEqual(gate([fixed], {}, { 'packages/db/src/fixed.ts': 'lines 0' }), [
    'packages/db/src/fixed.ts: lines 100.0, branches 100.0 meets the threshold now, remove it from DEBT',
  ]);
});

test('a listed file that no report measures fails (renamed or deleted)', () => {
  assert.deepEqual(
    gate([], { 'packages/db/src/gone.ts': 'why' }, { 'packages/db/src/old.ts': 'x' }),
    [
      'packages/db/src/gone.ts: listed but not measured (renamed or deleted?)',
      'packages/db/src/old.ts: listed but not measured (renamed or deleted?)',
    ],
  );
});

test('a package with no file measured fails: a coverage report is missing', () => {
  const failures = judge(merge([entry('packages/db/src/a.ts', [[1, 1]])], ROOT), {}, {});
  assert.equal(failures.length, PACKAGES.length - 1);
  assert.ok(failures.includes('apps/worker: no file measured (a coverage report is missing)'));
});

test('the lists name files of the backend, and no file is both exempt and in debt', () => {
  for (const file of [...Object.keys(EXEMPT), ...Object.keys(DEBT)])
    assert.ok(
      PACKAGES.some((p) => file.startsWith(`${p}/src/`)),
      file,
    );
  assert.deepEqual(
    Object.keys(EXEMPT).filter((f) => f in DEBT),
    [],
  );
});
