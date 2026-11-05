# shellcheck shell=bash
# Leads (L3a): code mutants of the rules of who sees and makes a lead (lead-access.ts) and of the store (lead-store.ts) that reads
# and makes them. No DDL: TABLES is only compared. Every mutant must turn an integration spec red: C2 (canSeeLead) by getLead since
# L3a-2. C5 (mayWriteLead) is not used by the store until L3b: its unit test (src/lead-access.test.ts) catches it, run by hand with the
# unit config (see leads-read.result.txt); L3b adds it here.
TABLES='public.leads'
SPECS='test/lead-store.spec.ts test/lead-write.spec.ts'
mutants() {
  run_code C1-list-sales-without-owner src/lead-store.ts 's/return or\(eq\(l\.createdBy, me\), eq\(l\.ownerUserId, me\)\);/return eq(l.createdBy, me);/'
  run_code C2-canSee-sales-without-owner src/lead-access.ts 's/  return isTheirs\(viewer\.userId, lead\);/  return lead.createdBy === viewer.userId;/'
  run_code C3-support-not-thrown src/lead-store.ts "s/  if \(scope === 'none'\) throw new LeadAccessDeniedError\(\);/  if (scope === 'none') return 'own';/"
  run_code C4-cursor-without-tie-break src/lead-store.ts 's/sql`\(\$\{l\.createdAt\}, \$\{l\.id\}\) < \(\$\{at\}::timestamptz, \$\{id\}::uuid\)`/sql`${l.createdAt} < ${at}::timestamptz`/'
  run_code C6-support-reads-workspace src/lead-access.ts "s/  support: 'none',/  support: 'workspace',/"
  run_code C7-create-any-role src/lead-access.ts 's/=> WRITERS\.includes\(role\);/=> role !== undefined;/'
  run_code C10-owner-any-role src/lead-store.ts 's/u\.role = ANY/u.role IS NOT NULL OR u.role = ANY/'
}
