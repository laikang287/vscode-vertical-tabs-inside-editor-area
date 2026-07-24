import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import yauzl from 'yauzl';
import packageJson from '../package.json' with { type: 'json' };

const vsixPath = `dist/${packageJson.name}-${packageJson.version}.vsix`;
await access(vsixPath, constants.R_OK);

const entries = await listZipEntries(vsixPath);
const forbiddenPrefixes = ['extension/src/', 'extension/test/', 'extension/scripts/', 'extension/dist/', 'extension/node_modules/', 'extension/out/test/'];
const forbidden = entries.filter((entry) => forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)));

if (forbidden.length > 0) {
  throw new Error(`VSIX 包含不应发布的文件：${forbidden.join(', ')}`);
}

for (const required of [
  'extension/package.json',
  'extension/out/extension.js',
  'extension/out/webview.js',
  'extension/out/codicon.css',
  'extension/out/codicon.ttf',
  'extension/THIRD_PARTY_NOTICES.md',
]) {
  if (!entries.includes(required)) {
    throw new Error(`VSIX 缺少必需文件：${required}`);
  }
}

console.log(`VSIX 内容校验通过：${vsixPath}`);

function listZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error(`无法打开 VSIX：${zipPath}`));
        return;
      }
      const result = [];
      zipFile.on('entry', (entry) => {
        result.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.once('error', reject);
      zipFile.once('end', () => resolve(result));
      zipFile.readEntry();
    });
  });
}
