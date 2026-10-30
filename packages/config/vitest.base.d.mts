export declare const coverage: {
  provider: 'v8';
  include: string[];
  exclude: string[];
  reporter: string[];
  thresholds: { lines: number; functions: number; branches: number; statements: number };
};

export declare const integrationCoverage: {
  enabled: true;
  provider: 'v8';
  include: string[];
  exclude: string[];
  reporter: string[];
  reportsDirectory: string;
};
