import { spawn } from 'node:child_process';
import * as path from 'node:path';

if (process.platform !== 'win32') {
  console.log('测试窗口显示器枚举目前仅支持 Windows。');
  process.exit(0);
}

const helperPath = path.resolve('scripts', 'manage-test-window.ps1');
const child = spawn('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  helperPath,
  '-ListDisplays',
], {
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  console.error(`无法枚举测试显示器：${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
  }
});
