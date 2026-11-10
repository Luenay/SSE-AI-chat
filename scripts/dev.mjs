/**
 * 项目启动器：自动挑选一个 Node 18+ 来运行前后端。
 *
 * 为什么需要它：项目代码用了 Node 18+ 才有的内置 fetch、AbortController、
 * node --watch，Vite 5 也要求 18+。有些机器终端里默认的 node 还是 14 / 16，
 * 直接跑会报 "AbortController is not defined" 之类的错。
 *
 * 这个文件本身只用最基础的 API，所以在 Node 14 下也能执行；
 * 它会自己去找高版本 Node，再拉起真正的服务。它只做进程编排，不含任何业务逻辑。
 *
 *   npm run dev          → node scripts/dev.mjs          同时启动后端 + 前端
 *   npm run dev:server   → node scripts/dev.mjs --server 只启动后端
 *   npm run dev:client   → node scripts/dev.mjs --client 只启动前端
 *   npm run smoke        → node scripts/dev.mjs --smoke  运行冒烟测试
 *
 * 若本机实在没有 Node 18+，可用环境变量显式指定：
 *   PowerShell:  $env:NODE_BINARY = "C:\path\to\node.exe"
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverDir = path.join(root, 'server');
const clientDir = path.join(root, 'client');
const mode = process.argv[2] || '--all';

/** 读取某个 node 可执行文件的完整版本号，读不到返回 null */
function versionOf(bin) {
  try {
    return execFileSync(bin, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function atLeast(version, major, minor) {
  if (!version) return false;
  const [a, b] = version.split('.').map(Number);
  return a > major || (a === major && b >= minor);
}

/** 列出本机所有可能的 Node 可执行文件 */
function candidates() {
  const list = [];
  if (process.env.NODE_BINARY) list.push(process.env.NODE_BINARY);
  list.push(process.execPath);

  if (process.platform === 'win32') {
    try {
      const found = execFileSync('where.exe', ['node'], { encoding: 'utf8' }).trim();
      list.push(...found.split(/\r?\n/).filter(Boolean));
    } catch { /* PATH 里没有别的 node */ }
    list.push('C:\\Program Files\\nodejs\\node.exe');
  } else {
    try {
      const found = execFileSync('which', ['-a', 'node'], { encoding: 'utf8' }).trim();
      list.push(...found.split(/\r?\n/).filter(Boolean));
    } catch { /* 忽略 */ }
    list.push('/usr/local/bin/node', '/usr/bin/node');
  }

  // 常见的多版本管理目录：CodeBuddy/WorkBuddy 自带运行时、nvm 等
  const home = os.homedir();
  const versionDirs = [
    path.join(home, '.workbuddy', 'binaries', 'node', 'versions'),
    path.join(home, '.codebuddy', 'binaries', 'node', 'versions'),
    path.join(home, '.nvm', 'versions', 'node'),
  ];
  for (const dir of versionDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const base = path.join(dir, name);
      list.push(path.join(base, 'node.exe'), path.join(base, 'bin', 'node'));
    }
  }
  return list;
}

/** 返回第一个版本 >= 18 的 node；找不到就返回 null */
function findNode() {
  const seen = new Set();
  for (const bin of candidates()) {
    const key = bin.toLowerCase();
    if (seen.has(key) || !fs.existsSync(bin)) continue;
    seen.add(key);
    const version = versionOf(bin);
    if (atLeast(version, 18, 0)) return { bin, version };
  }
  return null;
}

const node = findNode();
if (!node) {
  console.error('\n[launcher] 没有找到 Node.js 18 或更高版本，无法启动项目。');
  console.error(`[launcher] 当前终端使用的 Node 是 ${process.version}，业务代码需要 18+（内置 fetch / --watch，Vite 5 同样要求 18+）。`);
  console.error('\n任选一种方式解决：');
  console.error('  1) 安装 Node 20 LTS：https://nodejs.org/        （推荐，一劳永逸）');
  console.error('  2) nvm-windows：nvm install 20 然后 nvm use 20');
  console.error('  3) 已有高版本但没被找到时，指定路径：');
  console.error('     $env:NODE_BINARY = "C:\\path\\to\\node.exe"');
  console.error('     再执行 npm run dev\n');
  process.exit(1);
}

console.log(`[launcher] 使用 Node ${node.version}  (${node.bin})\n`);

// Node 18.11+ 才支持 --watch，老一点的版本就退化为「手动重启」
const watchFlag = atLeast(node.version, 18, 11) ? ['--watch'] : [];
const backendTask = {
  label: 'server',
  color: '\x1b[36m',
  cwd: serverDir,
  args: [...watchFlag, 'src/app.js'],
};
const clientTask = {
  label: 'client',
  color: '\x1b[32m',
  cwd: clientDir,
  args: [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173'],
};
const smokeTask = {
  label: 'smoke',
  color: '\x1b[35m',
  cwd: root,
  args: [path.join('scripts', 'smoke-test.mjs')],
};

const taskMap = {
  '--all': [backendTask, clientTask],
  '--server': [backendTask],
  '--client': [clientTask],
  '--smoke': [smokeTask],
};
const tasks = taskMap[mode];
if (!tasks) {
  console.error(`[launcher] 未知参数 ${mode}，可用：--all / --server / --client / --smoke`);
  process.exit(1);
}

/** 给每行输出加上来源前缀，两个服务的日志才不会混在一起 */
function forward(task, chunk) {
  const text = chunk.toString().replace(/\r?\n$/, '');
  for (const line of text.split(/\r?\n/)) {
    process.stdout.write(`${task.color}[${task.label}]\x1b[0m ${line}\n`);
  }
}

const children = [];
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code ?? 0;
}

for (const task of tasks) {
  const child = spawn(node.bin, task.args, {
    cwd: task.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => forward(task, chunk));
  child.stderr.on('data', (chunk) => forward(task, chunk));
  child.on('error', (error) => {
    console.error(`[launcher] ${task.label} 启动失败：${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    if (mode !== '--smoke') {
      console.log(`[launcher] ${task.label} 已退出（code ${code}），正在停止其他进程…`);
    }
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
});
