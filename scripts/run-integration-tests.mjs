import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const workspaceRoot = path.resolve(process.cwd());

await runTests({
  extensionDevelopmentPath: workspaceRoot,
  extensionTestsPath: path.resolve(workspaceRoot, 'out/test/integration/suite/index.js'),
  launchArgs: ['--disable-gpu', '--disable-workspace-trust'],
});
