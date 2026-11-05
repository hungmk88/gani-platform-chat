# shellcheck shell=bash
# pipeline_stages and pipeline_lost_reasons (L1a, #601; N200). P/G: policies and grants; D: the 8 DROP mutants the CEO approved on
# 05/11/2026; C: the code that picks the list of reasons in force.
TABLES='public.pipeline_stages public.pipeline_lost_reasons'
SPECS='test/pipeline-schema.spec.ts test/pipeline-read.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts test/tenant-isolation.spec.ts test/workspace-isolation.spec.ts'
mutants() {
  local S=public.pipeline_stages R=public.pipeline_lost_reasons t
  local OW='org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])'
  local ORG='org_id = (SELECT app.current_org())::uuid'
  local NAME="btrim(name) = name AND name <> '' AND char_length(name) <="
  local NFC='AND name = normalize(name, NFC)'
  for t in pipeline_stages pipeline_lost_reasons; do
    run "P-$t-app-no-workspace" "ALTER POLICY ${t}_app ON public.$t USING ($ORG) WITH CHECK ($ORG)" "ALTER POLICY ${t}_app ON public.$t USING ($OW) WITH CHECK ($OW)"
    run "P-$t-support-no-access-check" "ALTER POLICY ${t}_support ON public.$t USING ($OW)" "ALTER POLICY ${t}_support ON public.$t USING ($OW AND (SELECT app.support_access_ok()))"
    run "G-$t-app-insert" "GRANT INSERT ON public.$t TO app_role" "REVOKE INSERT ON public.$t FROM app_role"
    run "G-$t-app-update-name" "GRANT UPDATE (name) ON public.$t TO app_role" "REVOKE UPDATE (name) ON public.$t FROM app_role"
    run "G-$t-app-delete" "GRANT DELETE ON public.$t TO app_role" "REVOKE DELETE ON public.$t FROM app_role"
  done
  run D1-stages-drop-name-check "ALTER TABLE $S DROP CONSTRAINT pipeline_stages_name_check" "ALTER TABLE $S ADD CONSTRAINT pipeline_stages_name_check CHECK ($NAME 100 $NFC)"
  run D2-reasons-drop-name-check "ALTER TABLE $R DROP CONSTRAINT pipeline_lost_reasons_name_check" "ALTER TABLE $R ADD CONSTRAINT pipeline_lost_reasons_name_check CHECK ($NAME 200 $NFC)"
  run D3-stages-drop-position-check "ALTER TABLE $S DROP CONSTRAINT pipeline_stages_position_check" "ALTER TABLE $S ADD CONSTRAINT pipeline_stages_position_check CHECK (position >= 0)"
  run D4-reasons-drop-position-check "ALTER TABLE $R DROP CONSTRAINT pipeline_lost_reasons_position_check" "ALTER TABLE $R ADD CONSTRAINT pipeline_lost_reasons_position_check CHECK (position >= 0)"
  run D5-stages-drop-position-key "ALTER TABLE $S DROP CONSTRAINT pipeline_stages_position_key" "ALTER TABLE $S ADD CONSTRAINT pipeline_stages_position_key UNIQUE (org_id, workspace_id, position)"
  run D6-reasons-drop-name-key "DROP INDEX public.pipeline_lost_reasons_name_key" "CREATE UNIQUE INDEX pipeline_lost_reasons_name_key ON $R (org_id, workspace_id, effective_from, lower(name))"
  run D7-stages-drop-workspace-fk "ALTER TABLE $S DROP CONSTRAINT pipeline_stages_workspace_fk" "ALTER TABLE $S ADD CONSTRAINT pipeline_stages_workspace_fk FOREIGN KEY (org_id, workspace_id) REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT"
  run D8-reasons-drop-workspace-fk "ALTER TABLE $R DROP CONSTRAINT pipeline_lost_reasons_workspace_fk" "ALTER TABLE $R ADD CONSTRAINT pipeline_lost_reasons_workspace_fk FOREIGN KEY (org_id, workspace_id) REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT"
  run_code C1-in-force-strictly-before src/pipeline-read.ts 's/effective_from <= \$\{when\}/effective_from < ${when}/'
  run_code C2-in-force-ignores-future src/pipeline-read.ts 's/ AND l\.effective_from <= \$\{when\}//'
  run_code C3-in-force-any-list src/pipeline-read.ts 's/SELECT max\(l\.effective_from\)/SELECT min(l.effective_from)/'
}
