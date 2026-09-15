// Bundles src/cli.ts into one self-contained dist/cli.js so a global install
// ships no runtime dependencies and process spawn pays no module resolution.
//
// The output is ESM; CJS dependencies that call require() internally (dotenv,
// and the entry's own createRequire read of package.json for the version)
// need a require() shim, hence the banner. The banner also carries the
// shebang, which esbuild keeps as the first line.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);",
  },
});
