# shellcheck shell=bash
# The security store (P11a-2, N207): the checks of its code, not of the tables (those are lint/mutants/security.sh, P11a-1). No DDL.
TABLES='public.security_alerts public.security_incidents'
SPECS='test/security-store.spec.ts'
mutants() {
  run_code S1-handler-any-role src/security-store.ts "s/inArray\(orgMembers\.role, \['owner', 'admin'\]\),/inArray(orgMembers.role, ['owner', 'admin', 'manager']),/"
  run_code S2-handler-suspended src/security-store.ts "s/        eq\(orgMembers\.status, 'active'\),//"
  run_code S3-alert-covered-twice src/security-store.ts 's/\.where\(and\(inArray\(a\.id, alertIds\), isNull\(a\.incidentId\)\)\)/.where(inArray(a.id, alertIds))/'
  run_code S4-closed-changes-again src/security-store.ts "s/if \(row\.status === 'closed'\) throw/if (row.status === 'never') throw/"
}
