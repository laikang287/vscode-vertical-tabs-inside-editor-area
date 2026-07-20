import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const workspaceRoot = path.resolve(process.cwd());
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vertical-tabs-vscode-test-'));

try {
  await runTests({
    extensionDevelopmentPath: workspaceRoot,
    extensionTestsPath: path.resolve(workspaceRoot, 'out/test/integration/suite/index.js'),
    launchArgs: ['--disable-gpu', '--disable-workspace-trust', `--user-data-dir=${userDataDir}`],
  });
} finally {
  await fs.rm(userDataDir, { recursive: true, force: true });
}
