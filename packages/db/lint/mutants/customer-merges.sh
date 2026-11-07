# shellcheck shell=bash
# customer_merges, customer_merge_moves and the grants of the merge of customers (J3a, N204). P/G: policies and grants, no DROP; D: the
# 14 DROP mutants the CEO approved on 07/11/2026 (CHECK, foreign keys of the organisation, unique keys).
TABLES='public.customer_merges public.customer_merge_moves public.customers'
SPECS='test/customer-merges-schema.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts test/tenant-isolation.spec.ts'
mutants() {
  local t
  local ORG='org_id = (SELECT app.current_org())::uuid'
  for t in customer_merges customer_merge_moves; do
    run "P-$t-app-any-org" "ALTER POLICY ${t}_app ON public.$t USING (true) WITH CHECK (true)" "ALTER POLICY ${t}_app ON public.$t USING ($ORG) WITH CHECK ($ORG)"
    run "P-$t-support-no-access-check" "ALTER POLICY ${t}_support ON public.$t USING ($ORG)" "ALTER POLICY ${t}_support ON public.$t USING ($ORG AND (SELECT app.support_access_ok()))"
    run "G-$t-app-delete" "GRANT DELETE ON public.$t TO app_role" "REVOKE DELETE ON public.$t FROM app_role"
  done
  run G-moves-app-update-row "GRANT UPDATE (row_id) ON public.customer_merge_moves TO app_role" "REVOKE UPDATE (row_id) ON public.customer_merge_moves FROM app_role"
  run G-merges-app-update-target "GRANT UPDATE (target_id) ON public.customer_merges TO app_role" "REVOKE UPDATE (target_id) ON public.customer_merges FROM app_role"
  run G-merges-app-update-filled "GRANT UPDATE (filled_fields) ON public.customer_merges TO app_role" "REVOKE UPDATE (filled_fields) ON public.customer_merges FROM app_role"
  run G-identities-app-update-external "GRANT UPDATE (external_id) ON public.customer_identities TO app_role" "REVOKE UPDATE (external_id) ON public.customer_identities FROM app_role"
  run G-customers-support-reads-phone "GRANT SELECT (phone_e164) ON public.customers TO support_role" "REVOKE SELECT (phone_e164) ON public.customers FROM support_role"
  run G-merges-app-no-unmerge "REVOKE UPDATE (unmerged_at) ON public.customer_merges FROM app_role" "GRANT UPDATE (unmerged_at) ON public.customer_merges TO app_role"
  run G-tickets-app-no-customer-move "REVOKE UPDATE (customer_id) ON public.tickets FROM app_role" "GRANT UPDATE (customer_id) ON public.tickets TO app_role"
  local C=public.customers M=public.customer_merges V=public.customer_merge_moves
  local CUST='REFERENCES public.customers (org_id, id)'
  local MEMBER='REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT'
  run D1-customers-drop-merged-into-check "ALTER TABLE $C DROP CONSTRAINT customers_merged_into_check" "ALTER TABLE $C ADD CONSTRAINT customers_merged_into_check CHECK (merged_into <> id)"
  run D2-customers-drop-merged-at-check "ALTER TABLE $C DROP CONSTRAINT customers_merged_at_check" "ALTER TABLE $C ADD CONSTRAINT customers_merged_at_check CHECK ((merged_into IS NULL) = (merged_at IS NULL))"
  run D3-customers-drop-merged-into-fk "ALTER TABLE $C DROP CONSTRAINT customers_merged_into_fk" "ALTER TABLE $C ADD CONSTRAINT customers_merged_into_fk FOREIGN KEY (org_id, merged_into) $CUST ON DELETE NO ACTION"
  run D4-merges-drop-distinct-check "ALTER TABLE $M DROP CONSTRAINT customer_merges_distinct_check" "ALTER TABLE $M ADD CONSTRAINT customer_merges_distinct_check CHECK (source_id <> target_id)"
  run D5-merges-drop-filled-fields-check "ALTER TABLE $M DROP CONSTRAINT customer_merges_filled_fields_check" "ALTER TABLE $M ADD CONSTRAINT customer_merges_filled_fields_check CHECK (filled_fields <@ ARRAY['display_name', 'phone_e164', 'email'])"
  run D6-merges-drop-unmerged-check "ALTER TABLE $M DROP CONSTRAINT customer_merges_unmerged_check" "ALTER TABLE $M ADD CONSTRAINT customer_merges_unmerged_check CHECK ((unmerged_at IS NULL) = (unmerged_by IS NULL))"
  run D7-merges-drop-source-fk "ALTER TABLE $M DROP CONSTRAINT customer_merges_source_fk" "ALTER TABLE $M ADD CONSTRAINT customer_merges_source_fk FOREIGN KEY (org_id, source_id) $CUST ON DELETE RESTRICT"
  run D8-merges-drop-target-fk "ALTER TABLE $M DROP CONSTRAINT customer_merges_target_fk" "ALTER TABLE $M ADD CONSTRAINT customer_merges_target_fk FOREIGN KEY (org_id, target_id) $CUST ON DELETE RESTRICT"
  run D9-merges-drop-merged-by-fk "ALTER TABLE $M DROP CONSTRAINT customer_merges_merged_by_fk" "ALTER TABLE $M ADD CONSTRAINT customer_merges_merged_by_fk FOREIGN KEY (org_id, merged_by) $MEMBER"
  run D10-merges-drop-unmerged-by-fk "ALTER TABLE $M DROP CONSTRAINT customer_merges_unmerged_by_fk" "ALTER TABLE $M ADD CONSTRAINT customer_merges_unmerged_by_fk FOREIGN KEY (org_id, unmerged_by) $MEMBER"
  run D11-moves-drop-table-check "ALTER TABLE $V DROP CONSTRAINT customer_merge_moves_table_check" "ALTER TABLE $V ADD CONSTRAINT customer_merge_moves_table_check CHECK (table_name IN ('conversations', 'customer_identities', 'tickets', 'leads', 'customer_tags', 'customer_field_values'))"
  run D12-moves-drop-merge-fk "ALTER TABLE $V DROP CONSTRAINT customer_merge_moves_merge_fk" "ALTER TABLE $V ADD CONSTRAINT customer_merge_moves_merge_fk FOREIGN KEY (org_id, merge_id) REFERENCES public.customer_merges (org_id, id) ON DELETE RESTRICT"
  run D13-merges-drop-live-source-key "DROP INDEX public.customer_merges_live_source_key" "CREATE UNIQUE INDEX customer_merges_live_source_key ON $M (org_id, source_id) WHERE unmerged_at IS NULL"
  run D14-moves-drop-key "ALTER TABLE $V DROP CONSTRAINT customer_merge_moves_key" "ALTER TABLE $V ADD CONSTRAINT customer_merge_moves_key UNIQUE (org_id, merge_id, table_name, row_id)"
}
