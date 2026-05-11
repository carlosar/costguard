const esbuild = require('esbuild');

const minify = process.argv.includes('--minify');

const shared = {
  bundle:   true,
  external: ['vscode'],
  format:   'cjs',
  platform: 'node',
  target:   'node20',
  minify,
  sourcemap: !minify,
};

Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile:     'out/extension.js',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/cli.ts'],
    outfile:     'out/cli.js',
  }),
]).catch(() => process.exit(1));
