import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { isNoTransaction, lintMigrations, mask, run } from './lint-migrations.mjs';

const root = mkdtempSync(join(tmpdir(), 'lint-migrations-'));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
/** Write the given files (name -> SQL) into a fresh temp dir and lint it. */
function lint(files) {
  const dir = join(root, String(counter++));
  mkdirSync(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return { dir, ...lintMigrations(dir) };
}
const rules = (r) => r.errors.map((e) => e.rule);

const OK_NAME = '202610031200_create_orders.sql';
const ROLLBACK = '-- rollback: drop table orders (compensating migration)\n';
const RLS = `
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_org ON orders USING (org_id = app.current_org());
`;
const TABLE = 'CREATE TABLE orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);\n';

describe('MIG-RLS', () => {
  it('passes a table with org_id and ENABLE + FORCE + POLICY', () => {
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + TABLE + RLS })), []);
  });
  it('reports each missing part', () => {
    const r = lint({
      [OK_NAME]: ROLLBACK + TABLE + 'ALTER TABLE orders ENABLE ROW LEVEL SECURITY;',
    });
    assert.deepEqual(rules(r), ['MIG-RLS']);
    assert.match(r.errors[0].message, /FORCE ROW LEVEL SECURITY, CREATE POLICY/);
    assert.equal(r.errors[0].line, 2);
  });
  it('does not accept RLS for a different table', () => {
    const r = lint({ [OK_NAME]: ROLLBACK + TABLE + RLS.replaceAll('orders', 'other') });
    assert.deepEqual(rules(r), ['MIG-RLS']);
  });
  it('warns, without failing, on a table without org_id', () => {
    const r = lint({ [OK_NAME]: ROLLBACK + 'CREATE TABLE users (id uuid PRIMARY KEY);' });
    assert.deepEqual(rules(r), []);
    assert.deepEqual(
      r.warnings.map((w) => w.rule),
      ['MIG-RLS-SKIP'],
    );
  });
  it('checks partition children of a table with org_id', () => {
    const child = 'CREATE TABLE orders_2026_10 PARTITION OF orders FOR VALUES FROM (1) TO (2);\n';
    const bad = lint({ [OK_NAME]: ROLLBACK + TABLE + RLS + child });
    assert.deepEqual(rules(bad), ['MIG-RLS']);
    const fixed = child + RLS.replaceAll('orders', 'orders_2026_10');
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + TABLE + RLS + fixed })), []);
  });
  it('ignores org_id that only appears in a comment', () => {
    const r = lint({
      [OK_NAME]: ROLLBACK + 'CREATE TABLE notes (id uuid, /* org_id uuid, */ body text);',
    });
    assert.deepEqual(rules(r), []);
  });
});

describe('MIG-UUID', () => {
  it('reports gen_random_uuid() and uuid_generate_v4()', () => {
    const sql =
      'CREATE TABLE a (id uuid DEFAULT gen_random_uuid());\nCREATE TABLE b (id uuid DEFAULT uuid_generate_v4());';
    const r = lint({ [OK_NAME]: ROLLBACK + sql });
    assert.deepEqual(rules(r), ['MIG-UUID', 'MIG-UUID']);
  });
  it('ignores the names in comments and strings', () => {
    const sql = "-- no gen_random_uuid() here\nSELECT 'uuid_generate_v4()';";
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + sql })), []);
  });
});

describe('MIG-CASCADE', () => {
  const fk = (table, extra) =>
    `CREATE TABLE t (id uuid, x uuid REFERENCES ${table}(id) ${extra}, y int);`;
  it('reports ON DELETE CASCADE towards organizations and workspaces', () => {
    for (const table of ['organizations', 'public.workspaces']) {
      const r = lint({ [OK_NAME]: ROLLBACK + fk(table, 'ON DELETE CASCADE') });
      assert.deepEqual(rules(r), ['MIG-CASCADE'], table);
    }
  });
  it('allows RESTRICT, and CASCADE towards other tables', () => {
    assert.deepEqual(
      rules(lint({ [OK_NAME]: ROLLBACK + fk('organizations', 'ON DELETE RESTRICT') })),
      [],
    );
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + fk('orders', 'ON DELETE CASCADE') })), []);
  });
  it('does not blame a later column for an earlier constraint', () => {
    const sql =
      'CREATE TABLE t (a uuid REFERENCES organizations(id), b uuid REFERENCES orders(id) ON DELETE CASCADE);';
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + sql })), []);
  });
});

describe('MIG-DEFINER', () => {
  const fn = (clause) =>
    `CREATE FUNCTION app.f() RETURNS int LANGUAGE sql SECURITY DEFINER ${clause} AS $$ SELECT 1 $$;`;
  it('passes with the exact search_path', () => {
    const sql = fn('SET search_path = pg_catalog, public, pg_temp');
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + sql })), []);
  });
  it('reports a missing, or incomplete, search_path', () => {
    for (const clause of ['', 'SET search_path = public', 'SET search_path = pg_catalog, public']) {
      assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + fn(clause) })), ['MIG-DEFINER'], clause);
    }
  });
  it('ignores SECURITY INVOKER functions and the word inside a body', () => {
    const sql =
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $b$ SELECT 'SECURITY DEFINER' $b$;";
    assert.deepEqual(rules(lint({ [OK_NAME]: ROLLBACK + sql })), []);
  });
});

describe('MIG-ROLLBACK', () => {
  it('reports a missing block', () => {
    assert.deepEqual(rules(lint({ [OK_NAME]: 'SELECT 1;' })), ['MIG-ROLLBACK']);
  });
  it('reports an empty block', () => {
    assert.deepEqual(rules(lint({ [OK_NAME]: '-- rollback:\n\nSELECT 1;' })), ['MIG-ROLLBACK']);
  });
  it('accepts a description on the following comment lines', () => {
    assert.deepEqual(rules(lint({ [OK_NAME]: '-- rollback:\n--   drop it again\nSELECT 1;' })), []);
  });
});

describe('MIG-TXN', () => {
  const found = (sql) => lint({ [OK_NAME]: ROLLBACK + sql });

  it('reports BEGIN and COMMIT, in any case, with the line', () => {
    const r = found('begin;\nSELECT 1;\nCOMMIT;');
    assert.deepEqual(rules(r), ['MIG-TXN', 'MIG-TXN']);
    assert.deepEqual(
      r.errors.map((e) => e.line),
      [2, 4],
    );
  });

  it('reports the aliases that also end or restart the transaction', () => {
    for (const stmt of [
      'START TRANSACTION',
      'END',
      'ROLLBACK',
      'ABORT',
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
    ]) {
      assert.deepEqual(rules(found(`${stmt};`)), ['MIG-TXN'], stmt);
    }
  });

  it('ignores BEGIN and COMMIT inside comments and string literals', () => {
    const sql = "-- BEGIN;\n/* COMMIT; */\nSELECT 'BEGIN; COMMIT;';";
    assert.deepEqual(rules(found(sql)), []);
  });

  it('ignores BEGIN ... END inside a plpgsql body', () => {
    const sql = 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;';
    assert.deepEqual(rules(found(sql)), []);
  });

  it('ignores a BEGIN ATOMIC function body (PostgreSQL 14+) with several statements', () => {
    const sql =
      'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END;\nSELECT 3;';
    assert.deepEqual(rules(found(sql)), []);
    assert.deepEqual(rules(found(sql + '\nCOMMIT;')), ['MIG-TXN']);
  });
});

describe('MIG-NOTXN (review DB-03)', () => {
  const NOTXN = '-- migrate:no-transaction\n';
  const INDEX = 'CREATE INDEX CONCURRENTLY orders_org_idx ON orders (org_id);\n';
  const found = (sql) => lint({ [OK_NAME]: ROLLBACK + sql });

  it('accepts a no-transaction file that holds exactly one statement', () => {
    assert.deepEqual(rules(found(NOTXN + INDEX)), []);
  });

  it('reports a no-transaction file with two statements, or with none', () => {
    assert.deepEqual(rules(found(NOTXN + INDEX + 'SELECT 1;\n')), ['MIG-NOTXN']);
    assert.deepEqual(rules(found(NOTXN)), ['MIG-NOTXN']);
  });

  it('reads the directive only in the leading comments, not after SQL or inside a string or a body', () => {
    assert.equal(isNoTransaction(ROLLBACK + '\n' + NOTXN + INDEX), true);
    assert.equal(isNoTransaction(ROLLBACK + INDEX + NOTXN), false);
    assert.equal(isNoTransaction(ROLLBACK + "SELECT '\n-- migrate:no-transaction\n';"), false);
    assert.equal(isNoTransaction(ROLLBACK + '-- migrate: no-transaction later\n' + INDEX), false);
    assert.deepEqual(rules(found(INDEX + 'SELECT 1;\n')), []);
  });
});

describe('MIG-NAME', () => {
  const sql = ROLLBACK + 'SELECT 1;';
  it('reports a name that does not match the pattern', () => {
    assert.deepEqual(rules(lint({ 'init.sql': sql })), ['MIG-NAME']);
  });
  it('reports a month 13 and a day that does not exist', () => {
    assert.deepEqual(rules(lint({ '202613011200_create_x.sql': sql })), ['MIG-NAME']);
    assert.deepEqual(rules(lint({ '202602301200_create_x.sql': sql })), ['MIG-NAME']);
  });
  it('reports a verb outside the closed list', () => {
    assert.deepEqual(rules(lint({ '202610031200_make_x.sql': sql })), ['MIG-NAME']);
  });
  it('reports a duplicate timestamp', () => {
    const r = lint({ '202610031200_create_a.sql': sql, '202610031200_add_b.sql': sql });
    assert.deepEqual(rules(r), ['MIG-NAME']);
  });
  it('ignores files that are not .sql', () => {
    assert.equal(lint({ 'README.md': 'x' }).files, 0);
  });
});

describe('mask', () => {
  it('keeps length and line numbers', () => {
    const sql = "a -- c\n/* x\ny */ 'z''z' $q$ w\nw $q$ b";
    const out = mask(sql);
    assert.equal(out.length, sql.length);
    assert.equal(out.split('\n').length, sql.split('\n').length);
    assert.deepEqual(out.split(/\s+/).filter(Boolean), ['a', "'", "'", '$q$', '$q$', 'b']);
  });
  it('survives unterminated comments and $1 parameters', () => {
    assert.equal(mask('select $1 /* open').trim(), 'select $1');
  });
});

describe('run (CLI)', () => {
  const collect = (argv) => {
    const lines = [];
    return { code: run(argv, (l) => lines.push(l)), lines };
  };
  it('exits 0 when the directory is missing', () => {
    const { code, lines } = collect([join(root, 'does-not-exist')]);
    assert.equal(code, 0);
    assert.match(lines[0], /no migrations directory/);
  });
  it('exits 2 when the path cannot be read as a directory', () => {
    const file = join(root, 'a-file');
    writeFileSync(file, 'x');
    assert.equal(collect([file]).code, 2);
  });
  it('exits 1 on violations and prints no SQL text', () => {
    const secret = 'secret_marker_value';
    const { dir } = lint({ [OK_NAME]: `SELECT '${secret}', gen_random_uuid();` });
    const { code, lines } = collect([dir]);
    assert.equal(code, 1);
    assert.ok(lines.some((l) => l.startsWith('error ') && l.includes('MIG-UUID')));
    assert.ok(!lines.join('\n').includes(secret));
  });
  it('exits 0 on a clean directory (also through the real command line)', () => {
    const { dir } = lint({ [OK_NAME]: ROLLBACK + TABLE + RLS });
    assert.equal(collect([dir]).code, 0);
    const script = fileURLToPath(new URL('./lint-migrations.mjs', import.meta.url));
    const spawned = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    assert.equal(spawned.status, 0);
    assert.match(spawned.stdout, /0 error\(s\)/);
  });
});
