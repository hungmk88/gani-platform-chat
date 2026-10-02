const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tenant context holds something that is not a UUID. The message never echoes the value. */
export class InvalidTenantContextError extends Error {
  constructor(field: string) {
    super(`tenant context: ${field} is not a UUID`);
    this.name = 'InvalidTenantContextError';
  }
}

/** Lower-cased UUID, or throws. Ids end up in SQL parameters, so reject anything else early. */
export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InvalidTenantContextError(field);
  return value.toLowerCase();
}

/** PostgreSQL array literal for already validated UUIDs: `{a,b}`; no element needs quoting. */
export function toPgUuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}
