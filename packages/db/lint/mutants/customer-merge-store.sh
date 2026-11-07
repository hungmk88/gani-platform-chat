# shellcheck shell=bash
# The merge of customers and its undoing (J3b, N204): code mutants of customer-merge-store.ts. No DDL: TABLES is only compared. The
# order of the locks is not a mutant: merge and unmerge share lockCustomers, so they cannot lock in two orders; the crossing merges of
# the spec check that it does not deadlock.
TABLES='public.customers public.customer_merges public.customer_merge_moves'
SPECS='test/customer-merge-store.spec.ts'
mutants() {
  run_code C1-merge-into-deleted src/customer-merge-store.ts 's/x !== undefined \&\& x\.deletedAt === null \&\& x\.mergedInto === null;/x !== undefined \&\& x.mergedInto === null;/'
  run_code C2-fill-overwrites-target src/customer-merge-store.ts 's/\(f\) => target\[COLUMN\[f\]\] === null \&\& source\[COLUMN\[f\]\] !== null,/(f) => source[COLUMN[f]] !== null,/'
  run_code C3-tags-move-over-target src/customer-merge-store.ts "s/  if \(table === 'customer_tags'\) \{/  if (table === 'customer_tags' \&\& to === '') {/"
  run_code C4-unmerge-ignores-target-merged src/customer-merge-store.ts 's/  if \(target\.mergedInto !== null\) throw new MergeTargetMergedError\(\);/  if (target.mergedInto === sourceId) throw new MergeTargetMergedError();/'
  run_code C5-unmerge-moves-every-row src/customer-merge-store.ts 's/  if \(only !== undefined\) where\.push\(inArray\(t\.id, \[\.\.\.only\]\)\);/  if (only === null) where.push(inArray(t.id, [...only]));/'
  run_code C6-unmerge-clears-changed-field src/customer-merge-store.ts 's/      \.filter\(\(f\) => target\[COLUMN\[f\]\] === source\[COLUMN\[f\]\]\)/      .filter((f) => f !== undefined)/'
}
