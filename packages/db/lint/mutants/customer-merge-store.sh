# shellcheck shell=bash
# The merge of customers (J3b-1, N204, N205): code mutants of customer-merge-store.ts; the unmerge adds its own in J3b-2. No DDL:
# TABLES is only compared. The order of the locks is not a mutant: every lock of customers goes through lockCustomers, so there are
# not two orders; the crossing merges of the spec check that it does not deadlock.
TABLES='public.customers public.customer_merges public.customer_merge_moves'
SPECS='test/customer-merge-store.spec.ts'
mutants() {
  run_code C1-merge-into-deleted src/customer-merge-store.ts 's/x !== undefined \&\& x\.deletedAt === null \&\& x\.mergedInto === null;/x !== undefined \&\& x.mergedInto === null;/'
  run_code C2-fill-overwrites-target src/customer-merge-store.ts 's/\(f\) => target\[COLUMN\[f\]\] === null \&\& source\[COLUMN\[f\]\] !== null,/(f) => source[COLUMN[f]] !== null,/'
  run_code C3-tags-move-over-target src/customer-merge-store.ts "s/  if \(table === 'customer_tags'\) \{/  if (table === 'customer_tags' \&\& to === '') {/"
}
