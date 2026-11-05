# shellcheck shell=bash
# Leads (L3a, L3b): code mutants of the rules of who sees and changes a lead (lead-access.ts) and of the store (lead-store.ts) that
# reads, makes, moves and closes them. No DDL: TABLES is only compared. Every mutant must turn an integration spec red: C2 (canSeeLead)
# by getLead since L3a-2, C5 (mayWriteLead) by changeLeadStage and closeLead since L3b, no longer by the unit test alone.
TABLES='public.leads'
SPECS='test/lead-store.spec.ts test/lead-write.spec.ts'
mutants() {
  run_code C1-list-sales-without-owner src/lead-store.ts 's/return or\(eq\(l\.createdBy, me\), eq\(l\.ownerUserId, me\)\);/return eq(l.createdBy, me);/'
  run_code C2-canSee-sales-without-owner src/lead-access.ts 's/  return isTheirs\(viewer\.userId, lead\);/  return lead.createdBy === viewer.userId;/'
  run_code C3-support-not-thrown src/lead-store.ts "s/  if \(scope === 'none'\) throw new LeadAccessDeniedError\(\);/  if (scope === 'none') return 'own';/"
  run_code C4-cursor-without-tie-break src/lead-store.ts 's/sql`\(\$\{l\.createdAt\}, \$\{l\.id\}\) < \(\$\{at\}::timestamptz, \$\{id\}::uuid\)`/sql`${l.createdAt} < ${at}::timestamptz`/'
  run_code C5-mayWrite-sales-any src/lead-access.ts "s/  return viewer\.role !== 'sales' \|\| isTheirs\(viewer\.userId, lead\);/  return true;/"
  run_code C6-support-reads-workspace src/lead-access.ts "s/  support: 'none',/  support: 'workspace',/"
  run_code C7-create-any-role src/lead-access.ts 's/=> WRITERS\.includes\(role\);/=> role !== undefined;/'
  run_code C8-write-any-role src/lead-access.ts 's/  if \(!WRITERS\.includes\(viewer\.role\)\) return false;/  if (viewer.role === undefined) return false;/'
  run_code C9-hidden-is-forbidden src/lead-store.ts 's/    if \(canSeeLead\(viewer, lead\)\) throw new LeadAccessDeniedError\(\);/    throw new LeadAccessDeniedError();/'
  run_code C10-owner-any-role src/lead-store.ts 's/u\.role = ANY/u.role IS NOT NULL OR u.role = ANY/'
  run_code C11-no-version-check src/lead-store.ts 's/  if \(lead\.version !== version\) throw/  if (lead.version < 0) throw/'
  run_code C12-no-closed-check src/lead-store.ts "s/  if \(lead\.status !== 'open'\) throw/  if (lead.version < 0) throw/"
  run_code C13-same-stage-allowed src/lead-store.ts 's/  if \(to === lead\.stageId\) throw/  if (to === undefined) throw/'
  run_code C14-any-lost-reason src/lead-store.ts "s/    if \(!\(await lostReasonsInForce\(tx, lead\.workspaceId\)\)\.includes\(lostReason\)\)/    if (lostReason === '')/"
  run_code C15-audit-has-reason src/lead-store.ts 's/    detail: \{ outcome: close\.outcome \},/    detail: { outcome: close.outcome, lostReason },/'
}
