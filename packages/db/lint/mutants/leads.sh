# shellcheck shell=bash
# leads and lead_events (L1b). P/G: policies and grants, no DROP. The DROP mutants (CHECK, FK) wait for the CEO (05/11/2026).
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
}
