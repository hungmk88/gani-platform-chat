# shellcheck shell=bash
# leads and lead_events (L1b). P/G: policies and grants, no DROP; D: the 16 DROP mutants the CEO approved on 05/11/2026 (CHECK, FK;
# two foreign keys of the same workspace turned into keys that only check the organisation).
TABLES='public.leads public.lead_events'
SPECS='test/leads-schema.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts test/tenant-isolation.spec.ts test/workspace-isolation.spec.ts'
mutants() {
  local t
  local OW='org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])'
  local ORG='org_id = (SELECT app.current_org())::uuid'
  for t in leads lead_events; do
    run "P-$t-app-no-workspace" "ALTER POLICY ${t}_app ON public.$t USING ($ORG) WITH CHECK ($ORG)" "ALTER POLICY ${t}_app ON public.$t USING ($OW) WITH CHECK ($OW)"
    run "P-$t-support-no-access-check" "ALTER POLICY ${t}_support ON public.$t USING ($OW)" "ALTER POLICY ${t}_support ON public.$t USING ($OW AND (SELECT app.support_access_ok()))"
    run "G-$t-app-delete" "GRANT DELETE ON public.$t TO app_role" "REVOKE DELETE ON public.$t FROM app_role"
  done
  run G-leads-app-update-title "GRANT UPDATE (title) ON public.leads TO app_role" "REVOKE UPDATE (title) ON public.leads FROM app_role"
  run G-leads-app-update-created-by "GRANT UPDATE (created_by) ON public.leads TO app_role" "REVOKE UPDATE (created_by) ON public.leads FROM app_role"
  run G-leads-support-reads-title "GRANT SELECT (title) ON public.leads TO support_role" "REVOKE SELECT (title) ON public.leads FROM support_role"
  run G-lead_events-app-update-type "GRANT UPDATE (type) ON public.lead_events TO app_role" "REVOKE UPDATE (type) ON public.lead_events FROM app_role"
  local L=public.leads E=public.lead_events
  local TITLE="CHECK (btrim(title) = title AND title <> '' AND char_length(title) <= 200 AND title = normalize(title, NFC))"
  local LOST="CHECK ((status = 'lost') = (lost_reason IS NOT NULL) AND (lost_reason IS NULL OR (btrim(lost_reason) = lost_reason AND lost_reason <> '' AND char_length(lost_reason) <= 200 AND lost_reason = normalize(lost_reason, NFC))))"
  local SHAPE="CHECK (CASE type WHEN 'created' THEN from_stage_id IS NULL AND to_stage_id IS NOT NULL AND outcome IS NULL WHEN 'stage_changed' THEN from_stage_id IS NOT NULL AND to_stage_id IS NOT NULL AND from_stage_id <> to_stage_id AND outcome IS NULL WHEN 'closed' THEN from_stage_id IS NULL AND to_stage_id IS NULL AND outcome IS NOT NULL ELSE from_stage_id IS NULL AND to_stage_id IS NULL AND outcome IS NULL END)"
  local MEMBER='REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT'
  local STAGE='REFERENCES public.pipeline_stages (org_id, workspace_id, id) ON DELETE RESTRICT'
  run D1-leads-drop-title-check "ALTER TABLE $L DROP CONSTRAINT leads_title_check" "ALTER TABLE $L ADD CONSTRAINT leads_title_check $TITLE"
  run D2-leads-drop-status-check "ALTER TABLE $L DROP CONSTRAINT leads_status_check" "ALTER TABLE $L ADD CONSTRAINT leads_status_check CHECK (status IN ('open', 'won', 'lost'))"
  run D3-leads-drop-closed-at-check "ALTER TABLE $L DROP CONSTRAINT leads_closed_at_check" "ALTER TABLE $L ADD CONSTRAINT leads_closed_at_check CHECK ((status = 'open') = (closed_at IS NULL))"
  run D4-leads-drop-lost-reason-check "ALTER TABLE $L DROP CONSTRAINT leads_lost_reason_check" "ALTER TABLE $L ADD CONSTRAINT leads_lost_reason_check $LOST"
  run D5-leads-drop-version-check "ALTER TABLE $L DROP CONSTRAINT leads_version_check" "ALTER TABLE $L ADD CONSTRAINT leads_version_check CHECK (version >= 0)"
  run D6-events-drop-type-check "ALTER TABLE $E DROP CONSTRAINT lead_events_type_check" "ALTER TABLE $E ADD CONSTRAINT lead_events_type_check CHECK (type IN ('created', 'stage_changed', 'owner_changed', 'closed'))"
  run D7-events-drop-outcome-check "ALTER TABLE $E DROP CONSTRAINT lead_events_outcome_check" "ALTER TABLE $E ADD CONSTRAINT lead_events_outcome_check CHECK (outcome IS NULL OR outcome IN ('won', 'lost'))"
  run D8-events-drop-shape-check "ALTER TABLE $E DROP CONSTRAINT lead_events_shape_check" "ALTER TABLE $E ADD CONSTRAINT lead_events_shape_check $SHAPE"
  run D9-leads-drop-stage-fk "ALTER TABLE $L DROP CONSTRAINT leads_stage_fk" "ALTER TABLE $L ADD CONSTRAINT leads_stage_fk FOREIGN KEY (org_id, workspace_id, stage_id) $STAGE"
  run D10-leads-conversation-fk-org-only "ALTER TABLE $L DROP CONSTRAINT leads_conversation_fk, ADD CONSTRAINT leads_conversation_fk FOREIGN KEY (org_id, conversation_id) REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT" "ALTER TABLE $L DROP CONSTRAINT leads_conversation_fk, ADD CONSTRAINT leads_conversation_fk FOREIGN KEY (org_id, workspace_id, conversation_id) REFERENCES public.conversations (org_id, workspace_id, id) ON DELETE RESTRICT"
  run D11-leads-drop-customer-fk "ALTER TABLE $L DROP CONSTRAINT leads_customer_fk" "ALTER TABLE $L ADD CONSTRAINT leads_customer_fk FOREIGN KEY (org_id, customer_id) REFERENCES public.customers (org_id, id) ON DELETE RESTRICT"
  run D12-leads-drop-owner-fk "ALTER TABLE $L DROP CONSTRAINT leads_owner_fk" "ALTER TABLE $L ADD CONSTRAINT leads_owner_fk FOREIGN KEY (org_id, owner_user_id) $MEMBER"
  run D13-leads-drop-created-by-fk "ALTER TABLE $L DROP CONSTRAINT leads_created_by_fk" "ALTER TABLE $L ADD CONSTRAINT leads_created_by_fk FOREIGN KEY (org_id, created_by) $MEMBER"
  run D14-events-drop-lead-fk "ALTER TABLE $E DROP CONSTRAINT lead_events_lead_fk" "ALTER TABLE $E ADD CONSTRAINT lead_events_lead_fk FOREIGN KEY (org_id, workspace_id, lead_id) REFERENCES public.leads (org_id, workspace_id, id) ON DELETE RESTRICT"
  run D15-events-drop-to-stage-fk "ALTER TABLE $E DROP CONSTRAINT lead_events_to_stage_fk" "ALTER TABLE $E ADD CONSTRAINT lead_events_to_stage_fk FOREIGN KEY (org_id, workspace_id, to_stage_id) $STAGE"
  run D16-events-drop-from-stage-fk "ALTER TABLE $E DROP CONSTRAINT lead_events_from_stage_fk" "ALTER TABLE $E ADD CONSTRAINT lead_events_from_stage_fk FOREIGN KEY (org_id, workspace_id, from_stage_id) $STAGE"
}
