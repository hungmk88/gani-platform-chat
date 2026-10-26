/* global URL */
// Two files in dist/: loader.js (a classic script, IIFE, no Preact) and widget.js (an ES module the loader imports, one file).
import { build } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const common = {
  configFile: false,
  root,
  logLevel: 'warn',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
};

await build({
  ...common,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/loader.ts',
      formats: ['iife'],
      name: 'GaniWidgetLoader',
      fileName: () => 'loader.js',
    },
  },
});
await build({
  ...common,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/widget.tsx', formats: ['es'], fileName: () => 'widget.js' },
    // Vite keeps the whitespace of an ES library (for the bundler of whoever imports it); this file goes to browsers as is.
    rolldownOptions: { output: { minify: true } },
  },
});
