export function migrate(options: {
  connectionString: string;
  dir?: string;
  table?: string;
}): Promise<string[]>;
