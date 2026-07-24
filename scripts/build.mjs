import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { globSync } from 'glob';

const shared = {
  bundle: true,
  external: ['vscode', 'mocha', 'glob'],
  format: 'cjs',
  logLevel: 'info',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

await rm('out/test', { force: true, recursive: true });

await Promise.all([
  build({ ...shared, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' }),
  build({ ...shared, entryPoints: ['src/webview/main.ts'], outfile: 'out/webview.js' }),
  build({
    ...shared,
    entryPoints: ['src/testing/IntegrationTestWindowConfig.ts'],
    outfile: 'out/scripts/integration-test-window-config.cjs',
  }),
  build({
    ...shared,
    entryPoints: ['test/integration/suite/index.ts', 'test/integration/suite/extension.test.ts'],
    outbase: 'test/integration/suite',
    outdir: 'out/test/integration/suite',
  }),
  build({
    ...shared,
    entryPoints: globSync('test/unit/**/*.test.ts'),
    outbase: 'test/unit',
    outdir: 'out/test/unit',
  }),
]);

await mkdir('out', { recursive: true });
await Promise.all([
  copyFile('node_modules/@vscode/codicons/dist/codicon.css', 'out/codicon.css'),
  copyFile('node_modules/@vscode/codicons/dist/codicon.ttf', 'out/codicon.ttf'),
]);
