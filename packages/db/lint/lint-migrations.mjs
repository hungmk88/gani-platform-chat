// Migration linter (PR2b). Pattern checks on hand-written SQL; it does NOT replace
// tenant-isolation.spec, which runs against a real database (from PR3).
// Findings never echo SQL text, only file, line, rule id and a fixed message.
import console from 'node:console';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

// ADR-002: YYYYMMDDHHmm_<verb>_<object>.sql. Adding a verb = one entry here.
export const ALLOWED_VERBS = new Set([
  'create',
  'add',
  'alter',
  'drop',
  'rename',
  'backfill',
  'grant',
  'revoke',
  'enable',
  'disable',
  'seed',
]);

// Tables that use soft delete (Brief P8): a FK to them must never cascade.
const NO_CASCADE_TARGETS = new Set(['organizations', 'workspaces']);

// The runner wraps every file in one transaction; a statement that ends or restarts it can apply a file half way.
const TXN_CONTROL = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT)\b/i;

const NAME_RE = /^(\d{12})_([a-z]+)_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const IDENT = String.raw`(?:"?[\w]+"?\.)?"?[\w]+"?`;

/** Blank out comments, string literals and dollar-quoted bodies, keeping offsets and newlines. */
export function mask(sql) {
  const out = sql.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (sql[i] === '$') {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      const close = tag ? sql.indexOf(tag[0], i + tag[0].length) : -1;
      if (close === -1) {
        i += 1;
      } else {
        blank(i + tag[0].length, close);
        i = close + tag[0].length;
      }
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** Split masked SQL on `;` into statements with the line where each begins. */
function statements(masked) {
  const result = [];
  let start = 0;
  const push = (end) => {
    const text = masked.slice(start, end);
    const lead = text.length - text.trimStart().length;
    if (text.trim()) {
      const line = masked.slice(0, start + lead).split('\n').length;
      result.push({ text: text.trim(), line });
    }
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== ';') continue;
    // `BEGIN ATOMIC ...; ...; END` (SQL-standard function body) is one statement: read on to its own `END`.
    const text = masked.slice(start, i);
    if (/\bBEGIN\s+ATOMIC\b/i.test(text) && !/;\s*END\s*$/i.test(text)) continue;
    push(i);
    start = i + 1;
  }
  push(masked.length);
  return result;
}

/** `public."Users"` -> `users` (schema dropped, quotes dropped, lower-cased). */
const tableKey = (raw) => raw.replaceAll('"', '').split('.').pop().toLowerCase();

const lineAt = (stmt, index) => stmt.line + stmt.text.slice(0, index).split('\n').length - 1;

function checkName(file, seen) {
  const m = NAME_RE.exec(file);
  if (!m)
    return [
      {
        rule: 'MIG-NAME',
        line: 1,
        message: 'file name must match YYYYMMDDHHmm_<verb>_<object>.sql',
      },
    ];
  const [, ts, verb] = m;
  const found = [];
  const [y, mo, d, h, mi] = [
    ts.slice(0, 4),
    ts.slice(4, 6),
    ts.slice(6, 8),
    ts.slice(8, 10),
    ts.slice(10),
  ].map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    h < 24 &&
    mi < 60;
  if (!valid)
    found.push({ rule: 'MIG-NAME', line: 1, message: 'timestamp is not a valid date and time' });
  if (!ALLOWED_VERBS.has(verb))
    found.push({ rule: 'MIG-NAME', line: 1, message: 'verb is not in the allowed list' });
  if (seen.has(ts))
    found.push({ rule: 'MIG-NAME', line: 1, message: 'timestamp is already used by another file' });
  seen.add(ts);
  return found;
}

function checkRollback(raw) {
  const lines = raw.split('\n');
  const at = lines.findIndex((l) => /^\s*--\s*rollback:/i.test(l));
  const miss = {
    rule: 'MIG-ROLLBACK',
    line: 1,
    message: 'missing "-- rollback:" block with a description',
  };
  if (at === -1) return [miss];
  let described = /^\s*--\s*rollback:\s*\S/i.test(lines[at]);
  for (let i = at + 1; !described && i < lines.length && /^\s*--/.test(lines[i]); i++) {
    described = /^\s*--\s*\S/.test(lines[i]);
  }
  return described ? [] : [{ ...miss, line: at + 1 }];
}

function checkTables(stmts, orgTables, warnings) {
  const found = [];
  for (const s of stmts) {
    const create = new RegExp(
      String.raw`^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`,
      'i',
    ).exec(s.text);
    if (!create) continue;
    const name = tableKey(create[1]);
    const parent = new RegExp(String.raw`\bPARTITION\s+OF\s+(${IDENT})`, 'i').exec(s.text);
    const hasOrg = parent
      ? orgTables.has(tableKey(parent[1]))
      : /[(,]\s*"?org_id"?\s+[a-z]/i.test(s.text);
    if (!hasOrg) {
      warnings.push({
        rule: 'MIG-RLS-SKIP',
        line: s.line,
        message: 'table has no org_id; RLS not checked here (see tenant-isolation.spec)',
      });
      continue;
    }
    orgTables.add(name);
    const on = String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(${IDENT})\s+`;
    const has = (re) =>
      stmts.some((o) => ((m) => m && tableKey(m[1]) === name)(new RegExp(re, 'i').exec(o.text)));
    const missing = [];
    if (!has(`^${on}ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`)) missing.push('ENABLE ROW LEVEL SECURITY');
    if (!has(`^${on}FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`)) missing.push('FORCE ROW LEVEL SECURITY');
    if (!has(String.raw`^CREATE\s+POLICY\s+"?\w+"?\s+ON\s+(?:ONLY\s+)?(${IDENT})`))
      missing.push('CREATE POLICY');
    if (missing.length) {
      found.push({
        rule: 'MIG-RLS',
        line: s.line,
        message: `table with org_id is missing in the same file: ${missing.join(', ')}`,
      });
    }
  }
  return found;
}

function checkStatements(stmts, masked) {
  const found = [];
  for (const m of masked.matchAll(/\b(?:gen_random_uuid|uuid_generate_v4)\s*\(/gi)) {
    const line = masked.slice(0, m.index).split('\n').length;
    found.push({
      rule: 'MIG-UUID',
      line,
      message: 'UUIDv4 generator is forbidden; ids are UUIDv7 generated by the application',
    });
  }
  const fk = new RegExp(String.raw`REFERENCES\s+(${IDENT})\s*(?:\([^)]*\))?([^,]*)`, 'gi');
  const definer = /\bSECURITY\s+DEFINER\b/i;
  const safePath =
    /\bSET\s+search_path\s*(?:=|\bTO\b)\s*pg_catalog\s*,\s*public\s*,\s*pg_temp\b(?!\s*,)/i;
  for (const s of stmts) {
    if (TXN_CONTROL.test(s.text)) {
      found.push({
        rule: 'MIG-TXN',
        line: s.line,
        message:
          'transaction control is forbidden; the runner already wraps each file in a transaction',
      });
    }
    for (const m of s.text.matchAll(fk)) {
      if (NO_CASCADE_TARGETS.has(tableKey(m[1])) && /\bON\s+DELETE\s+CASCADE\b/i.test(m[2])) {
        found.push({
          rule: 'MIG-CASCADE',
          line: lineAt(s, m.index),
          message: 'ON DELETE CASCADE from organizations/workspaces is forbidden (soft delete)',
        });
      }
    }
    if (
      /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(s.text) &&
      definer.test(s.text) &&
      !safePath.test(s.text)
    ) {
      found.push({
        rule: 'MIG-DEFINER',
        line: s.line,
        message: 'SECURITY DEFINER requires SET search_path = pg_catalog, public, pg_temp',
      });
    }
  }
  return found;
}

/** Lint every .sql file in `dir`, in name order. Returns findings, never throws on lint failures. */
export function lintMigrations(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const orgTables = new Set();
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n');
    const masked = mask(raw);
    const stmts = statements(masked);
    const tableWarnings = [];
    const all = [
      ...checkName(file, seen),
      ...checkRollback(raw),
      ...checkTables(stmts, orgTables, tableWarnings),
      ...checkStatements(stmts, masked),
    ];
    errors.push(...all.map((f) => ({ file, ...f })));
    warnings.push(...tableWarnings.map((f) => ({ file, ...f })));
  }
  return { files: files.length, errors, warnings };
}

const format = (kind, f) => `${kind} ${f.file}:${f.line} ${f.rule} ${f.message}`;

/** CLI body. Exit code: 0 clean, 1 violations, 2 could not run. */
export function run(argv, write = (line) => console.log(line)) {
  const dir = argv[0] ?? fileURLToPath(new URL('../migrations/', import.meta.url));
  let result;
  try {
    result = lintMigrations(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      write(`lint-migrations: no migrations directory (${basename(dir)}); nothing to check`);
      return 0;
    }
    write(`lint-migrations: cannot read migrations (${error?.code ?? 'unknown error'})`);
    return 2;
  }
  result.warnings.forEach((f) => write(format('warning', f)));
  result.errors.forEach((f) => write(format('error', f)));
  write(
    `lint-migrations: ${result.files} file(s), ${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
  );
  return result.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
