// The variables a quick reply may hold in Đợt 1 (C7, endpoint-M8 §2, N163). The Inbox fills them from the conversation; a message still
// holding one is never sent to a customer (422 unresolved_variable, N163).
export const TEMPLATE_VARIABLES = [
  'customer_name',
  'agent_name',
  'company_name',
  'company_phone',
] as const;

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The names between {{ and }} in `text`, in order of appearance, each once. */
export function variablesOf(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1] ?? ''))];
}

/** The variables of `text` that are not of Đợt 1. */
export function unknownVariables(text: string): string[] {
  return variablesOf(text).filter(
    (name) => !(TEMPLATE_VARIABLES as readonly string[]).includes(name),
  );
}

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * `text` with each variable of Đợt 1 replaced by its value; one without a value (null or blank) stays as written and is named in
 * `unresolved`, in order of appearance.
 */
export function render(
  text: string,
  values: Readonly<Partial<Record<TemplateVariable, string | null>>>,
): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const out = text.replace(VARIABLE, (whole, name: string) => {
    const value = (values as Record<string, string | null | undefined>)[name]?.trim();
    if (value) return value;
    unresolved.add(name);
    return whole;
  });
  return { text: out, unresolved: [...unresolved] };
}
