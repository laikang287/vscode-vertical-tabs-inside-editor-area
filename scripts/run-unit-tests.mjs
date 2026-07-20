import { spawnSync } from 'node:child_process';
import { globSync } from 'glob';

const tests = globSync('out/test/unit/**/*.test.js');
if (tests.length === 0) {
  throw new Error('没有找到已编译的单元测试；请先执行 npm run compile。');
}

const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
