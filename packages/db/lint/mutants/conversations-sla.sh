# shellcheck shell=bash
# The SLA columns of conversations (E1, N208). Two parts, chosen with SLA_PART: G (the default) adds a wrong grant and takes it back (no
# REVOKE of a real one, whose GRANT back would reorder the ACL pg_dump prints), no DROP; D is the DROP
# mutants of the four CHECKs, run only with SLA_PART=D once the CEO approved them (CLAUDE.md, packages/db/CLAUDE.md).
TABLES='public.conversations'
SPECS='test/conversations-sla-schema.spec.ts test/grants.spec.ts'
mutants() {
  local part="${SLA_PART:-G}" C=public.conversations
  if [ "$part" = G ]; then
    run G-support-updates-sla "GRANT UPDATE (sla_due_at) ON $C TO support_role" "REVOKE UPDATE (sla_due_at) ON $C FROM support_role"
    run G-app-updates-sla-wrongly "GRANT UPDATE (created_at) ON $C TO app_role" "REVOKE UPDATE (created_at) ON $C FROM app_role"
  fi
  if [ "$part" = D ]; then
    run D1-drop-paused-reason-check "ALTER TABLE $C DROP CONSTRAINT conversations_sla_paused_reason_check" "ALTER TABLE $C ADD CONSTRAINT conversations_sla_paused_reason_check CHECK (sla_paused_reason IS NULL OR sla_paused_reason IN ('waiting_customer', 'outside_hours'))"
    run D2-drop-remaining-check "ALTER TABLE $C DROP CONSTRAINT conversations_sla_remaining_check" "ALTER TABLE $C ADD CONSTRAINT conversations_sla_remaining_check CHECK (sla_remaining_seconds IS NULL OR sla_remaining_seconds >= 0)"
    run D3-drop-pause-check "ALTER TABLE $C DROP CONSTRAINT conversations_sla_pause_check" "ALTER TABLE $C ADD CONSTRAINT conversations_sla_pause_check CHECK ((sla_paused_reason IS NULL) = (sla_remaining_seconds IS NULL))"
    run D4-drop-due-check "ALTER TABLE $C DROP CONSTRAINT conversations_sla_due_check" "ALTER TABLE $C ADD CONSTRAINT conversations_sla_due_check CHECK (sla_paused_reason IS NULL OR sla_due_at IS NOT NULL)"
  fi
}
