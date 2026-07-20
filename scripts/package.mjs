import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import packageJson from '../package.json' with { type: 'json' };

await mkdir('dist', { recursive: true });
const output = `dist/${packageJson.name}-${packageJson.version}.vsix`;
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vsce', 'package', '--out', output], {
  stdio: 'inherit',
});
