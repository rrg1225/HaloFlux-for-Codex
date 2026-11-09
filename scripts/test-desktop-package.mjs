import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const zip = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'output/desktop/packaged.json');
const root = mkdtempSync(join(tmpdir(), 'haloflux-desktop-package-'));
const target = join(root, 'HaloFlux 安装 测试');
const profile = join(root, 'profile');
const system = join(process.env.SystemRoot, 'System32');
const powershell = join(system, 'WindowsPowerShell/v1.0/powershell.exe');
const exe = join(target, 'HaloFlux.exe');
const env = { ...process.env, PATH: system, APPDATA: profile, LOCALAPPDATA: profile, CODEX_HOME: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
mkdirSync(target);
mkdirSync(profile);
mkdirSync(dirname(output), { recursive: true });
const result = { archive: basename(zip), launches: [] };

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'ignore', ...options });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { child, exited };
}
async function ps(command) {
  return (await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: 10000, windowsHide: true })).stdout.trim();
}
async function census() {
  return JSON.parse(await ps('ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | ' +
    'Select-Object ProcessId,ParentProcessId,ExecutablePath,@{n="Created";e={$_.CreationDate.ToFileTimeUtc().ToString()}})'));
}
function descendants(list, pid) {
  const ids = new Set([pid]);
  for (let size = 0; size !== ids.size;) {
    size = ids.size;
    for (const entry of list) if (ids.has(entry.ParentProcessId)) ids.add(entry.ProcessId);
  }
  return list.filter(entry => ids.has(entry.ProcessId));
}
async function until(operation, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const value = await operation();
    if (value) return value;
    await delay(150);
  } while (Date.now() < end);
  throw new Error('Timed out waiting for ' + label);
}
async function originFor(pids) {
  const { stdout } = await run(join(system, 'netstat.exe'), ['-ano', '-p', 'tcp'], { timeout: 5000, windowsHide: true });
  for (const match of stdout.matchAll(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+0\.0\.0\.0:0\s+\S+\s+(\d+)\s*$/gm)) {
    if (!pids.some(entry => entry.ProcessId === Number(match[2]))) continue;
    const origin = 'http://127.0.0.1:' + match[1];
    const response = await fetch(origin, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (response?.status === 403 && (await response.json()).error) return origin;
  }
}
const external = launch(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
try {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(zip)) digest.update(chunk);
  result.sha256 = digest.digest('hex');
  assert.equal(readFileSync(zip + '.sha256', 'ascii'), result.sha256 + '  ' + basename(zip) + '\n');
  execFileSync(join(system, 'tar.exe'), ['-xf', zip, '-C', target], { windowsHide: true });
  for (const name of ['START-HERE.md', 'LICENSE-HALOFLUX.txt', 'NOTICE.md', 'LICENSE', 'LICENSES.chromium.html']) {
    assert.ok(existsSync(join(target, name)), name);
  }
  assert.equal(existsSync(join(target, 'resources/default_app.asar')), false);
  assert.equal(existsSync(join(target, 'resources/app/test')), false);
  assert.equal(existsSync(join(target, 'resources/app/node_modules')), false);
  assert.equal(existsSync(join(target, 'codex.exe')), false);
  for (let round = 0; round < 3; round++) {
    const instance = launch(exe, round === 0 ? [] : ['--workspace', target], { env, windowsHide: false });
    const pid = instance.child.pid;
    const observed = new Map();
    const observe = async () => {
      for (const item of descendants(await census(), pid)) observed.set(item.ProcessId, item);
      return [...observed.values()];
    };
    try {
      await until(async () => (await ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`)) ===
        'HaloFlux for Codex', 'native window');
      const origin = await until(async () => originFor(await observe()), 'owned private bridge');
      if (round === 0) {
        const duplicate = launch(exe, ['--workspace', target], { env, windowsHide: false });
        try {
          const closed = await until(() => Promise.race([duplicate.exited.then(code => ({ code })), delay(100)]),
            'single-instance duplicate');
          assert.equal(closed.code, 0);
          result.duplicateExited = true;
        } finally { if (duplicate.child.exitCode === null) duplicate.child.kill(); }
      }
      await observe();
      assert.equal(await ps(`(Get-Process -Id ${pid}).CloseMainWindow()`), 'True');
      const closed = await until(() => Promise.race([instance.exited.then(code => ({ code })), delay(100)]), 'normal close');
      assert.equal(closed.code, 0);
      await assert.rejects(fetch(origin));
      await until(async () => {
        const list = await census();
        return !list.some(entry => entry.ExecutablePath?.toLowerCase() === exe.toLowerCase() ||
          (observed.has(entry.ProcessId) && observed.get(entry.ProcessId).Created === entry.Created));
      }, 'owned processes to exit');
      assert.equal(external.child.exitCode, null);
      assert.equal(external.child.signalCode, null);
      process.kill(external.child.pid, 0);
      result.launches.push({ ownedProcesses: observed.size, remaining: 0, portReleased: true, unrelatedNodeAlive: true });
    } finally { if (instance.child.exitCode === null) instance.child.kill(); }
  }
  result.passed = true;
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  external.child.kill();
  await external.exited;
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  if (result.passed) {
    const directory = realpathSync(root);
    if (dirname(directory) === realpathSync(tmpdir()) && basename(directory).startsWith('haloflux-desktop-package-')) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
