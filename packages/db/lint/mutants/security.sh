# shellcheck shell=bash
# security_alerts, security_incidents, the end of an access session and app.access_session_org (P11a, N207). Two parts, chosen with
# SECURITY_PART: PGF (the default) is the policies, the grants and the function, no DROP; D is the DROP mutants of the CHECKs, the
# foreign keys and the unique key, run only with SECURITY_PART=D once the CEO approved them (CLAUDE.md, packages/db/CLAUDE.md).
TABLES='public.security_alerts public.security_incidents public.platform_access_logs'
SPECS='test/security-incidents.spec.ts test/grants.spec.ts test/rls-all-tables.spec.ts test/support-access.spec.ts'
fn() { # the body of app.access_session_org with the conditions given, one per argument
  local where='' c
  for c in "$@"; do where="$where AND $c"; done
  echo "CREATE OR REPLACE FUNCTION app.access_session_org(p_session uuid, p_operator uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS \$\$ SELECT l.org_id FROM public.platform_access_logs l JOIN public.users u ON u.id = l.operator_user_id WHERE l.id = p_session$where \$\$"
}
mutants() {
  local part="${SECURITY_PART:-PGF}" t
  local ORG='org_id = (SELECT app.current_org())::uuid'
  local C1='l.operator_user_id = p_operator' C2='now() < l.expires_at' C3='l.ended_at IS NULL' C4='u.is_platform_operator'
  local REAL
  REAL="$(fn "$C1" "$C2" "$C3" "$C4")"
  if [ "$part" = PGF ]; then
    for t in security_incidents security_alerts; do
      run "P-$t-app-any-org" "ALTER POLICY ${t}_app ON public.$t USING (true) WITH CHECK (true)" "ALTER POLICY ${t}_app ON public.$t USING ($ORG) WITH CHECK ($ORG)"
      run "P-$t-support-no-access-check" "ALTER POLICY ${t}_support ON public.$t USING ($ORG)" "ALTER POLICY ${t}_support ON public.$t USING ($ORG AND (SELECT app.support_access_ok()))"
      run "G-$t-app-delete" "GRANT DELETE ON public.$t TO app_role" "REVOKE DELETE ON public.$t FROM app_role"
    done
    run G-incidents-app-update-title "GRANT UPDATE (title) ON public.security_incidents TO app_role" "REVOKE UPDATE (title) ON public.security_incidents FROM app_role"
    run G-incidents-app-update-opener "GRANT UPDATE (opened_by_operator_id) ON public.security_incidents TO app_role" "REVOKE UPDATE (opened_by_operator_id) ON public.security_incidents FROM app_role"
    run G-alerts-app-update-kind "GRANT UPDATE (kind) ON public.security_alerts TO app_role" "REVOKE UPDATE (kind) ON public.security_alerts FROM app_role"
    run G-incidents-support-reads-title "GRANT SELECT (title) ON public.security_incidents TO support_role" "REVOKE SELECT (title) ON public.security_incidents FROM support_role"
    run G-function-app-role "GRANT EXECUTE ON FUNCTION app.access_session_org(uuid, uuid) TO app_role" "REVOKE EXECUTE ON FUNCTION app.access_session_org(uuid, uuid) FROM app_role"
    run G-function-support-role "GRANT EXECUTE ON FUNCTION app.access_session_org(uuid, uuid) TO support_role" "REVOKE EXECUTE ON FUNCTION app.access_session_org(uuid, uuid) FROM support_role"
    run F1-function-any-operator "$(fn "$C2" "$C3" "$C4")" "$REAL"
    run F2-function-ignores-expiry "$(fn "$C1" "$C3" "$C4")" "$REAL"
    run F3-function-ignores-end "$(fn "$C1" "$C2" "$C4")" "$REAL"
    run F4-function-any-person "$(fn "$C1" "$C2" "$C3")" "$REAL"
  fi
  if [ "$part" = D ]; then
    local I=public.security_incidents A=public.security_alerts L=public.platform_access_logs
    local MEMBER='REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT'
    run D1-incidents-drop-opener-check "ALTER TABLE $I DROP CONSTRAINT security_incidents_opener_check" "ALTER TABLE $I ADD CONSTRAINT security_incidents_opener_check CHECK (num_nonnulls(opened_by_user_id, opened_by_operator_id) = 1)"
    run D2-incidents-drop-title-check "ALTER TABLE $I DROP CONSTRAINT security_incidents_title_check" "ALTER TABLE $I ADD CONSTRAINT security_incidents_title_check CHECK (btrim(title) <> '' AND char_length(title) <= 200)"
    run D3-incidents-drop-severity-check "ALTER TABLE $I DROP CONSTRAINT security_incidents_severity_check" "ALTER TABLE $I ADD CONSTRAINT security_incidents_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical'))"
    run D4-incidents-drop-status-check "ALTER TABLE $I DROP CONSTRAINT security_incidents_status_check" "ALTER TABLE $I ADD CONSTRAINT security_incidents_status_check CHECK (status IN ('open', 'closed'))"
    run D5-incidents-drop-closed-check "ALTER TABLE $I DROP CONSTRAINT security_incidents_closed_check" "ALTER TABLE $I ADD CONSTRAINT security_incidents_closed_check CHECK ((status = 'closed') = (closed_at IS NOT NULL))"
    run D6-incidents-drop-handler-fk "ALTER TABLE $I DROP CONSTRAINT security_incidents_handler_fk" "ALTER TABLE $I ADD CONSTRAINT security_incidents_handler_fk FOREIGN KEY (org_id, handler_user_id) $MEMBER"
    run D7-incidents-drop-opener-member-fk "ALTER TABLE $I DROP CONSTRAINT security_incidents_opened_by_user_fk" "ALTER TABLE $I ADD CONSTRAINT security_incidents_opened_by_user_fk FOREIGN KEY (org_id, opened_by_user_id) $MEMBER"
    run D8-incidents-drop-opener-operator-fk "ALTER TABLE $I DROP CONSTRAINT security_incidents_opened_by_operator_fk" "ALTER TABLE $I ADD CONSTRAINT security_incidents_opened_by_operator_fk FOREIGN KEY (opened_by_operator_id) REFERENCES public.users (id) ON DELETE RESTRICT"
    run D9-alerts-drop-channel-fk "ALTER TABLE $A DROP CONSTRAINT security_alerts_channel_account_fk" "ALTER TABLE $A ADD CONSTRAINT security_alerts_channel_account_fk FOREIGN KEY (org_id, channel_account_id) REFERENCES public.channel_accounts (org_id, id) ON DELETE RESTRICT"
    run D10-alerts-drop-incident-fk "ALTER TABLE $A DROP CONSTRAINT security_alerts_incident_fk" "ALTER TABLE $A ADD CONSTRAINT security_alerts_incident_fk FOREIGN KEY (org_id, incident_id) REFERENCES public.security_incidents (org_id, id) ON DELETE RESTRICT"
    run D11-alerts-drop-window-key "ALTER TABLE $A DROP CONSTRAINT security_alerts_window_key" "ALTER TABLE $A ADD CONSTRAINT security_alerts_window_key UNIQUE NULLS NOT DISTINCT (org_id, kind, subject_user_id, channel_account_id, window_start)"
    run D12-alerts-drop-kind-check "ALTER TABLE $A DROP CONSTRAINT security_alerts_kind_check" "ALTER TABLE $A ADD CONSTRAINT security_alerts_kind_check CHECK (kind IN ('login_failures', 'two_factor_locked', 'two_factor_reset', 'platform_access', 'webhook_signature_invalid', 'bulk_export'))"
    run D13-alerts-drop-severity-check "ALTER TABLE $A DROP CONSTRAINT security_alerts_severity_check" "ALTER TABLE $A ADD CONSTRAINT security_alerts_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical'))"
    run D14-alerts-drop-count-check "ALTER TABLE $A DROP CONSTRAINT security_alerts_count_check" "ALTER TABLE $A ADD CONSTRAINT security_alerts_count_check CHECK (count >= 1)"
    run D15-sessions-drop-end-check "ALTER TABLE $L DROP CONSTRAINT platform_access_logs_end_check" "ALTER TABLE $L ADD CONSTRAINT platform_access_logs_end_check CHECK ((ended_at IS NULL) = (end_reason IS NULL))"
    run D16-sessions-drop-end-reason-check "ALTER TABLE $L DROP CONSTRAINT platform_access_logs_end_reason_check" "ALTER TABLE $L ADD CONSTRAINT platform_access_logs_end_reason_check CHECK (end_reason IS NULL OR end_reason IN ('manual', 'expired'))"
  fi
}
