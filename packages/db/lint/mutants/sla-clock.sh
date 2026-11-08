# shellcheck shell=bash
# app.sla_running_orgs (E4b-1, N211): each condition of the function and its grant (CEO 07/11/2026, 2.1). No DROP: the mutants
# replace the body with CREATE OR REPLACE and add a grant, and put back the real one.
TABLES='public.conversations public.organizations'
SPECS='test/sla-clock-store.spec.ts test/security-definer.spec.ts'
fn() { # the body of app.sla_running_orgs with the join condition $1 and the filter $2
  echo "CREATE OR REPLACE FUNCTION app.sla_running_orgs(p_limit integer) RETURNS TABLE (org_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS \$\$ BEGIN IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE = '22023'; END IF; RETURN QUERY SELECT c.org_id FROM public.conversations c JOIN public.organizations o ON o.id = c.org_id$1 WHERE $2 GROUP BY c.org_id ORDER BY c.org_id LIMIT p_limit; END \$\$"
}
mutants() {
  local LIVE=' AND o.deleted_at IS NULL'
  local SLA='c.sla_due_at IS NOT NULL' CLOCK="(c.sla_paused_reason IS NULL OR c.sla_paused_reason = 'outside_hours')"
  local REAL
  REAL="$(fn "$LIVE" "$SLA AND $CLOCK")"
  run F1-any-org-with-a-conversation "$(fn "$LIVE" "true")" "$REAL"
  run F2-customer-pause-counts "$(fn "$LIVE" "$SLA")" "$REAL"
  run F3-deleted-org-counts "$(fn "" "$SLA AND $CLOCK")" "$REAL"
  run G-support-role-runs-it "GRANT EXECUTE ON FUNCTION app.sla_running_orgs(integer) TO support_role" "REVOKE EXECUTE ON FUNCTION app.sla_running_orgs(integer) FROM support_role"
  run G-auth-role-runs-it "GRANT EXECUTE ON FUNCTION app.sla_running_orgs(integer) TO auth_role" "REVOKE EXECUTE ON FUNCTION app.sla_running_orgs(integer) FROM auth_role"
  run L-no-limit-check "$(fn "$LIVE" "$SLA AND $CLOCK" | sed "s/IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN RAISE EXCEPTION 'p_limit must be between 1 and 1000' USING ERRCODE = '22023'; END IF; //")" "$REAL"
}
