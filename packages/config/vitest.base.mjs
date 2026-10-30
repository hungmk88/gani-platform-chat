// Shared Vitest coverage settings (Brief P20: unit coverage; CLAUDE.md: new modules >= 80%).
// `json` writes coverage/coverage-final.json, which the CI job `coverage` merges with the integration runs (infra/CLAUDE.md "Coverage").
export const coverage = {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/main.ts'],
  reporter: ['text', 'json'],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
};

// The integration runs of db, api and worker (test:integration): the same files, json only and no threshold. They are a measurement
// for the per-file gate of the CI job `coverage`, never a gate of their own.
export const integrationCoverage = {
  enabled: true,
  provider: 'v8',
  include: coverage.include,
  exclude: coverage.exclude,
  reporter: ['json'],
  reportsDirectory: 'coverage-integration',
};
