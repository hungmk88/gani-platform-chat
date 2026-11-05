# shellcheck shell=bash
# conversation_notes (C6-1, #592): 9/9 caught on 05/11/2026.
TABLES='public.conversation_notes'
SPECS='test/conversation-notes-schema.spec.ts test/conversation-note-store.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts'
mutants() {
  local T=public.conversation_notes
  local VIS='org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id)'
  local ORG='org_id = (SELECT app.current_org())::uuid'
  local BODY="CHECK (btrim(body) <> '' AND char_length(body) <= CASE kind WHEN 'transfer_reason' THEN 500 ELSE 2000 END AND body = normalize(body, NFC))"
  run D1-policy-no-visibility "ALTER POLICY conversation_notes_app ON $T USING ($ORG) WITH CHECK ($ORG)" "ALTER POLICY conversation_notes_app ON $T USING ($VIS) WITH CHECK ($VIS)"
  run D2-drop-body-check "ALTER TABLE $T DROP CONSTRAINT conversation_notes_body_check" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_body_check $BODY"
  run D3-drop-kind-check "ALTER TABLE $T DROP CONSTRAINT conversation_notes_kind_check" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_kind_check CHECK (kind IN ('note', 'transfer_reason'))"
  run D4-drop-author-fk "ALTER TABLE $T DROP CONSTRAINT conversation_notes_author_fk" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_author_fk FOREIGN KEY (org_id, author_user_id) REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT"
  run D5-drop-conversation-fk "ALTER TABLE $T DROP CONSTRAINT conversation_notes_conversation_fk" "ALTER TABLE $T ADD CONSTRAINT conversation_notes_conversation_fk FOREIGN KEY (org_id, conversation_id) REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT"
  run D6-grant-update-body "GRANT UPDATE (body) ON $T TO app_role" "REVOKE UPDATE (body) ON $T FROM app_role"
  run D7-grant-delete "GRANT DELETE ON $T TO app_role" "REVOKE DELETE ON $T FROM app_role"
  run D8-support-reads-body "GRANT SELECT (body) ON $T TO support_role" "REVOKE SELECT (body) ON $T FROM support_role"
  run D9-support-policy-no-access-check "ALTER POLICY conversation_notes_support ON $T USING ($VIS)" "ALTER POLICY conversation_notes_support ON $T USING ($VIS AND (SELECT app.support_access_ok()))"
}
