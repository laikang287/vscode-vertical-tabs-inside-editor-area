import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

await mkdir('dist', { recursive: true });
const output = `dist/${packageJson.name}-${packageJson.version}.vsix`;
const vsceCli = path.resolve('node_modules', '@vscode', 'vsce', 'vsce');
execFileSync(process.execPath, [vsceCli, 'package', '--out', output], {
  stdio: 'inherit',
});
