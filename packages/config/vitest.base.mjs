// Shared Vitest coverage settings (Brief P20: unit coverage; CLAUDE.md: new modules >= 80%).
export const coverage = {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/main.ts'],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
};
