#!/usr/bin/env bash
# Mutation testing of the database (CEO 05/11/2026, after #592): a mutant weakens one rule of a table (a policy, a CHECK, a foreign key,
# a grant) or of the code that reads it, the specs must go red, then the rule is put back exactly. Only on a scratch database of a
# developer (gani_*), never on production nor staging: every mutant DROPs or ALTERs and restores (CLAUDE.md "Không DELETE/TRUNCATE/DROP
# nếu chưa xác nhận"; a mutant that needs a DROP is shown to the CEO first). The schema of the tables is dumped before and after with
# pg_dump -s and must be identical, but for the random \restrict token pg_dump writes on each run.
#
# Usage (from packages/db, with the env of the scratch database loaded):
#   DB_MUTANTS_CONFIRM=yes bash lint/db-mutants.sh lint/mutants/<set>.sh [out-dir]
# A set (lint/mutants/*.sh) sets TABLES (what pg_dump compares) and SPECS, and defines `mutants`, a list of `run` (DDL, DDL that
# restores) and `run_code` (a file of src/, the sed expression of the mutant) lines. One line a mutant: name | exit of vitest (1 = red,
# as it must be) | count | the red tests. A mutant with exit 0 is a survivor: stop and report it, never waive it.
set -u -o pipefail
[ "${DB_MUTANTS_CONFIRM:-}" = yes ] || { echo 'db-mutants: set DB_MUTANTS_CONFIRM=yes (DDL on the database)'; exit 2; }
[ "${APP_ENV:-dev}" = dev ] || { echo "db-mutants: APP_ENV=${APP_ENV} refused: scratch databases only"; exit 2; }
case "${DATABASE_URL_MIGRATION:-}" in
  *@localhost[:/]*gani_* | *@127.0.0.1[:/]*gani_*) ;;
  *) echo 'db-mutants: DATABASE_URL_MIGRATION must be a local scratch database gani_*'; exit 2 ;;
esac
SET=${1:-}
[ -f "$SET" ] || { echo 'db-mutants: name a set, lint/mutants/<set>.sh'; exit 2; }
OUT=${2:-$(mktemp -d)}
psql -q -At "$DATABASE_URL_MIGRATION" -c 'SELECT 1' >/dev/null || { echo 'db-mutants: the database does not answer'; exit 2; }
FAILED=0
TABLES='' SPECS=''
# shellcheck source=/dev/null
. "$SET"
[ -n "$TABLES" ] && [ -n "$SPECS" ] || { echo "db-mutants: $SET sets no TABLES or SPECS"; exit 2; }

dump() { # an empty or failed dump stops everything: two empty dumps would look identical
  local args=() t
  for t in $TABLES; do args+=(-t "$t"); done
  pg_dump -s "${args[@]}" "$DATABASE_URL_MIGRATION" >"$1.raw" || { echo 'db-mutants: pg_dump failed'; exit 2; }
  grep -v '^--\|^SET \|^SELECT pg_catalog\|^\\restrict\|^\\unrestrict' "$1.raw" >"$1"
  [ "$(grep -c 'CREATE TABLE' "$1")" -eq "$(echo "$TABLES" | wc -w)" ] || { echo "db-mutants: not every table of $TABLES in the dump"; exit 2; }
}
specs() { # name: runs the specs, prints the line of the mutant, flags a survivor
  # shellcheck disable=SC2086
  npx vitest run --config vitest.integration.config.ts $SPECS >"$OUT/$1.log" 2>&1
  local code=$?
  [ $code -ne 0 ] || FAILED=1
  echo "$1|exit=$code|$(grep -E '^ +Tests ' "$OUT/$1.log" | tr -s ' ')|$(grep -E '^ +× ' "$OUT/$1.log" | sed -E 's/^ +× //' | cut -c1-100 | tr '\n' ';')"
}
run() { # name, the DDL of the mutant, the DDL that restores the rule
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL_MIGRATION" -c "$2" >/dev/null || { echo "$1|APPLY FAILED"; FAILED=1; return; }
  specs "$1"
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL_MIGRATION" -c "$3" >/dev/null || { echo "$1|RESTORE FAILED: stop, restore by hand"; exit 1; }
}
run_code() { # name, a file of src/, the sed expression of the mutant: the file is put back from its copy
  cp "$2" "$OUT/$1.orig"
  sed -i -E "$3" "$2"
  if cmp -s "$2" "$OUT/$1.orig"; then echo "$1|APPLY FAILED (the expression changes nothing)"; FAILED=1; return; fi
  specs "$1"
  cp "$OUT/$1.orig" "$2" && cmp -s "$2" "$OUT/$1.orig" || { echo "$1|RESTORE FAILED: stop, git checkout $2"; exit 1; }
}

dump "$OUT/before.sql"
mutants
dump "$OUT/after.sql"
if diff -q "$OUT/before.sql" "$OUT/after.sql" >/dev/null; then echo "schema identical after restore ($OUT)"; exit $FAILED; else echo "SCHEMA DIFFERS: stop"; diff "$OUT/before.sql" "$OUT/after.sql"; exit 1; fi
