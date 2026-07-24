import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import configModule from '../out/scripts/integration-test-window-config.cjs';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const workspaceRoot = path.resolve(process.cwd());
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vertical-tabs-vscode-test-'));
const statusFile = path.join(userDataDir, 'window-manager-status.json');
const configPath = path.resolve(workspaceRoot, '.vscode-test-window.json');
const windowConfig = await readWindowConfig(configPath);
const shouldManageWindow = process.platform === 'win32' && windowConfig.enabled;
let windowManager;

try {
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  if (shouldManageWindow) {
    windowManager = await startWindowManager({
      config: windowConfig,
      executablePath: vscodeExecutablePath,
      statusFile,
      userDataDir,
    });
  } else if (windowConfig.enabled) {
    console.warn('测试窗口位置与焦点管理目前仅支持 Windows；本次按原有方式启动集成测试。');
  }

  await runTests({
    extensionDevelopmentPath: workspaceRoot,
    extensionTestsPath: path.resolve(workspaceRoot, 'out/test/integration/suite/index.js'),
    launchArgs: ['--disable-gpu', '--disable-workspace-trust', `--user-data-dir=${userDataDir}`],
    vscodeExecutablePath,
  });

  if (shouldManageWindow) {
    await verifyWindowWasManaged(statusFile, windowConfig);
  }
} finally {
  windowManager?.kill();
  await fs.rm(userDataDir, { recursive: true, force: true });
}

async function readWindowConfig(filePath) {
  let value = {};
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    console.log(`使用本机测试窗口配置：${filePath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`无法读取测试窗口配置 ${filePath}：${error.message}`, { cause: error });
    }
    console.log(`未找到 ${filePath}，使用安全默认测试窗口配置。`);
  }
  return configModule.parseIntegrationTestWindowConfig(value);
}

async function startWindowManager({ config, executablePath, statusFile, userDataDir }) {
  const helperPath = path.resolve(workspaceRoot, 'scripts', 'manage-test-window.ps1');
  const child = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helperPath,
    '-ExecutablePath',
    executablePath,
    '-UserDataDir',
    userDataDir,
    '-Display',
    config.display,
    '-X',
    String(config.x),
    '-Y',
    String(config.y),
    '-Width',
    String(config.width),
    '-Height',
    String(config.height),
    '-PreventFocus',
    String(config.preventFocus),
    '-StatusFile',
    statusFile,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[test-window] ${chunk}`);
      stdoutBuffer += chunk;
      if (!settled && stdoutBuffer.split(/\r?\n/u).some((line) => line.startsWith('READY '))) {
        settled = true;
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[test-window] ${chunk}`);
      stderrBuffer += chunk;
    });
    child.once('error', (error) => rejectOnce(
      new Error(`无法启动测试窗口管理器：${error.message}`, { cause: error }),
    ));
    child.once('exit', (code) => rejectOnce(
      new Error(`测试窗口管理器在启动 VS Code 前退出（退出码 ${code}）：${stderrBuffer.trim()}`),
    ));
  });

  return child;
}

async function verifyWindowWasManaged(filePath, config) {
  let status;
  try {
    const text = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/u, '');
    status = JSON.parse(text);
  } catch (error) {
    throw new Error('集成测试已结束，但窗口管理器没有确认成功管理测试窗口。', { cause: error });
  }

  const expectedDisplay = config.display.replace(/^\\\\\.\\/u, '').toLowerCase();
  if (expectedDisplay !== 'primary' && status.display.toLowerCase() !== expectedDisplay) {
    throw new Error(`测试窗口位于 ${status.display}，与配置的 ${config.display} 不一致。`);
  }
  if (status.width !== config.width || status.height !== config.height || status.preventFocus !== config.preventFocus) {
    throw new Error(`测试窗口管理结果与配置不一致：${JSON.stringify(status)}`);
  }
  console.log(`测试窗口管理验证通过：${status.display} ${status.width}x${status.height}，禁止抢焦点=${status.preventFocus}`);
}
