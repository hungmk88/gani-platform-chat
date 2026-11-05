#!/usr/bin/env bash
# Mutation testing of the database (CEO 05/11/2026, after #592): a mutant weakens one rule of a table (a policy, a CHECK, a foreign key,
# a grant), the specs must go red, then the rule is put back exactly. Only on a scratch database of a developer (gani_*), never on
# production nor staging: every mutant DROPs or ALTERs and restores (CLAUDE.md "Không DELETE/TRUNCATE/DROP nếu chưa xác nhận"; a
# mutant that needs a DROP is shown to the CEO first). The schema of the table is dumped before and after with pg_dump -s and must be
# identical, but for the random \restrict token pg_dump writes on each run.
#
# Usage (from packages/db, with the env of the scratch database loaded):
#   DB_MUTANTS_CONFIRM=yes bash lint/db-mutants.sh [out-dir]
# One line a mutant: name | exit of vitest (1 = red, as it must be) | count | the red tests. A mutant with exit 0 is a survivor: stop
# and report it, never waive it.
#
# The mutants below are those of conversation_notes (#592, 9/9 caught on 05/11/2026). A new table adds its own `run` lines.
set -u -o pipefail
[ "${DB_MUTANTS_CONFIRM:-}" = yes ] || { echo 'db-mutants: set DB_MUTANTS_CONFIRM=yes (DDL on the database)'; exit 2; }
[ "${APP_ENV:-dev}" = dev ] || { echo "db-mutants: APP_ENV=${APP_ENV} refused: scratch databases only"; exit 2; }
case "${DATABASE_URL_MIGRATION:-}" in
  *@localhost[:/]*gani_* | *@127.0.0.1[:/]*gani_*) ;;
  *) echo 'db-mutants: DATABASE_URL_MIGRATION must be a local scratch database gani_*'; exit 2 ;;
esac
OUT=${1:-$(mktemp -d)}
psql -q -At "$DATABASE_URL_MIGRATION" -c 'SELECT 1' >/dev/null || { echo 'db-mutants: the database does not answer'; exit 2; }
FAILED=0
SPECS='test/conversation-notes-schema.spec.ts test/conversation-note-store.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts'
T=public.conversation_notes
VIS='org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id)'
ORG='org_id = (SELECT app.current_org())::uuid'
BODY="CHECK (btrim(body) <> '' AND char_length(body) <= CASE kind WHEN 'transfer_reason' THEN 500 ELSE 2000 END AND body = normalize(body, NFC))"

dump() { # an empty or failed dump stops everything: two empty dumps would look identical
  pg_dump -s -t $T "$DATABASE_URL_MIGRATION" >"$1.raw" || { echo 'db-mutants: pg_dump failed'; exit 2; }
  grep -v '^--\|^SET \|^SELECT pg_catalog\|^\\restrict\|^\\unrestrict' "$1.raw" >"$1"
  grep -q 'CREATE TABLE' "$1" || { echo "db-mutants: no table $T in the dump"; exit 2; }
}
run() { # name, the DDL of the mutant, the DDL that restores the rule
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL_MIGRATION" -c "$2" >/dev/null || { echo "$1|APPLY FAILED"; FAILED=1; return; }
  # shellcheck disable=SC2086
  npx vitest run --config vitest.integration.config.ts $SPECS >"$OUT/$1.log" 2>&1
  local code=$?
  [ $code -ne 0 ] || FAILED=1 # a survivor
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL_MIGRATION" -c "$3" >/dev/null || { echo "$1|RESTORE FAILED: stop, restore by hand"; exit 1; }
  echo "$1|exit=$code|$(grep -E 'Tests ' "$OUT/$1.log" | tr -s ' ')|$(grep -E '^ +× ' "$OUT/$1.log" | sed -E 's/^ +× //' | cut -c1-100 | tr '\n' ';')"
}

dump "$OUT/before.sql"
run D1-policy-no-visibility "ALTER POLICY conversation_notes_app ON $T USING ($ORG) WITH CHECK ($ORG)" "ALTER POLICY conversation_notes_app ON $T USING ($VIS) WITH CHECK ($VIS)"
run D2-drop-body-check "ALTER TABLE $T DROP CONSTRAINT conversation_notes_body_check" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_body_check $BODY"
run D3-drop-kind-check "ALTER TABLE $T DROP CONSTRAINT conversation_notes_kind_check" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_kind_check CHECK (kind IN ('note', 'transfer_reason'))"
run D4-drop-author-fk "ALTER TABLE $T DROP CONSTRAINT conversation_notes_author_fk" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_author_fk FOREIGN KEY (org_id, author_user_id) REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT"
run D5-drop-conversation-fk "ALTER TABLE $T DROP CONSTRAINT conversation_notes_conversation_fk" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_conversation_fk FOREIGN KEY (org_id, conversation_id) REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT"
run D6-grant-update-body "GRANT UPDATE (body) ON $T TO app_role" "REVOKE UPDATE (body) ON $T FROM app_role"
run D7-grant-delete "GRANT DELETE ON $T TO app_role" "REVOKE DELETE ON $T FROM app_role"
run D8-support-reads-body "GRANT SELECT (body) ON $T TO support_role" "REVOKE SELECT (body) ON $T FROM support_role"
run D9-support-policy-no-access-check "ALTER POLICY conversation_notes_support ON $T USING ($VIS)" "ALTER POLICY conversation_notes_support ON $T USING ($VIS AND (SELECT app.support_access_ok()))"
dump "$OUT/after.sql"
if diff -q "$OUT/before.sql" "$OUT/after.sql" >/dev/null; then echo "schema identical after restore ($OUT)"; exit $FAILED; else echo "SCHEMA DIFFERS: stop"; diff "$OUT/before.sql" "$OUT/after.sql"; exit 1; fi
