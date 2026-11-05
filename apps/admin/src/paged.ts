// A list read by cursor ("Tải thêm", P9), shared by the screens that read one: #29 Bảo mật, then #23 Dữ liệu khách.

/**
 * The rows of the pages read, each once: a record put at the head between two pages shifts the next page onto rows seen. Rows are
 * told apart by `id`, or by `keyOf` for rows that have none (#30: a company is its `orgId`).
 */
export function uniqueRows<T>(
  pages: readonly { readonly data: readonly T[] }[],
  keyOf: (r: T) => string = (r) => (r as { readonly id: string }).id,
): T[] {
  const seen = new Set<string>();
  return pages
    .flatMap((p) => p.data)
    .filter((r) => !seen.has(keyOf(r)) && Boolean(seen.add(keyOf(r))));
}
