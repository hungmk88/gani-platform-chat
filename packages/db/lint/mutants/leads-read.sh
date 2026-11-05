# shellcheck shell=bash
# Reading leads (L3a-1): code mutants of the scope rules (lead-access.ts) and of the store (lead-store.ts). No DDL: TABLES is only
# compared. C2 (canSeeLead) and C5 (mayWriteLead) are not used by the store yet: their unit test (src/lead-access.test.ts) catches them,
# run by hand with the unit config until L3a-2 and L3b use them (see leads-read.result.txt); those PRs add them here.
TABLES='public.leads'
SPECS='test/lead-store.spec.ts'
mutants() {
  run_code C1-list-sales-without-owner src/lead-store.ts 's/return or\(eq\(l\.createdBy, me\), eq\(l\.ownerUserId, me\)\);/return eq(l.createdBy, me);/'
  run_code C3-support-not-thrown src/lead-store.ts "s/  if \(scope === 'none'\) throw new LeadAccessDeniedError\(\);/  if (scope === 'none') return 'own';/"
  run_code C4-cursor-without-tie-break src/lead-store.ts 's/sql`\(\$\{l\.createdAt\}, \$\{l\.id\}\) < \(\$\{at\}::timestamptz, \$\{id\}::uuid\)`/sql`${l.createdAt} < ${at}::timestamptz`/'
  run_code C6-support-reads-workspace src/lead-access.ts "s/  support: 'none',/  support: 'workspace',/"
}
