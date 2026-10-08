// Bundles the worker and CLI into self-contained ESM files (dist/worker.mjs, dist/cli.mjs).
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

await build({
  entryPoints: { worker: 'src/worker/main.ts', cli: 'src/cli/main.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  alias: { '@': path.join(root, 'src') },
  // keep native/optional bits out of the bundle
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
