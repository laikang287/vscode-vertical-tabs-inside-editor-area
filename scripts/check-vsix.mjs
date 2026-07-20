import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import packageJson from '../package.json' with { type: 'json' };

const vsixPath = `dist/${packageJson.name}-${packageJson.version}.vsix`;
await access(vsixPath, constants.R_OK);

const entries = execFileSync('unzip', ['-Z1', vsixPath], { encoding: 'utf8' }).trim().split('\n');
const forbiddenPrefixes = ['extension/src/', 'extension/test/', 'extension/scripts/', 'extension/dist/', 'extension/node_modules/', 'extension/out/test/'];
const forbidden = entries.filter((entry) => forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)));

if (forbidden.length > 0) {
  throw new Error(`VSIX 包含不应发布的文件：${forbidden.join(', ')}`);
}

for (const required of ['extension/package.json', 'extension/out/extension.js', 'extension/out/webview.js']) {
  if (!entries.includes(required)) {
    throw new Error(`VSIX 缺少必需文件：${required}`);
  }
}

console.log(`VSIX 内容校验通过：${vsixPath}`);
