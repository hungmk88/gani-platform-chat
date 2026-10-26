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
