// A list read by cursor ("Tải thêm", P9), shared by the screens that read one (#29 Bảo mật, #23 Dữ liệu khách).

/** The rows of the pages read, each once: a record put at the head between two pages shifts the next page onto rows seen. */
export function uniqueRows<T extends { readonly id: string }>(
  pages: readonly { readonly data: readonly T[] }[],
): T[] {
  const seen = new Set<string>();
  return pages.flatMap((p) => p.data).filter((r) => !seen.has(r.id) && Boolean(seen.add(r.id)));
}
