import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const FAILURE = Object.freeze({
  application: 'APPLICATION_BUG',
  sandbox: 'CODEX_SANDBOX_FAILURE',
  protocol: 'CODEX_PROTOCOL_ERROR',
  auth: 'AUTHENTICATION_ERROR',
  environment: 'UNKNOWN_ENVIRONMENT_ERROR',
});

export const FAILURE_HINTS = Object.freeze({
  [FAILURE.application]: '本地桥接处理失败。导出诊断报告以便复现。',
  [FAILURE.sandbox]: 'Codex 沙箱运行失败。可继续模拟演练；检查 Windows 沙箱日志与 Codex 安装。',
  [FAILURE.protocol]: 'Codex 协议不兼容或响应无效。运行 npm run check:protocol 核对本机版本。',
  [FAILURE.auth]: 'Codex 身份验证失败。请在本机检查 codex login status。',
  [FAILURE.environment]: 'Codex 运行环境不可用。检查 CLI、登录状态和本地连接。',
});

export function codexFailure({ code, codexErrorInfo, message } = {}) {
  if (codexErrorInfo === 'sandboxError' ||
    (code === 'helper_unknown_error' && /^setup refresh had errors\b/i.test(message ?? '')) ||
    (typeof message === 'string' &&
    /helper_unknown_error:\s*setup refresh had errors|windows sandbox(?: failed|:).*setup refresh/i.test(message))) {
    return FAILURE.sandbox;
  }
  if (codexErrorInfo === 'unauthorized' || (typeof message === 'string' &&
    /\bnot logged in\b|\bauthentication (?:failed|required)\b|\binvalid api key\b/i.test(message))) {
    return FAILURE.auth;
  }
  if ([-32700, -32600, -32601, -32602].includes(code)) return FAILURE.protocol;
  return FAILURE.environment;
}

export function createHealthCheck(resolveCodex, live) {
  let cached, checkedAt = 0;
  const checkSandboxMarker = async () => {
    if (process.platform !== 'win32') return false;
    const root = process.env.CODEX_HOME || join(homedir(), '.codex');
    try {
      const file = await open(join(root, '.sandbox', 'setup_error.json'), 'r');
      try {
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await file.read(buffer);
        return codexFailure(JSON.parse(buffer.toString('utf8', 0, bytesRead))) === FAILURE.sandbox;
      } finally { await file.close(); }
    } catch { return false; }
  };
  const checkCli = async () => {
    const cli = { status: 'failed' };
    const login = { status: 'unchecked' };
    const options = { windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024 };
    try {
      const binary = resolveCodex();
      const { stdout } = await execute(binary, ['--version'], options);
      const version = /^codex-cli (\d+\.\d+\.\d+(?:[-.][a-z0-9.-]+)?)\s*$/i.exec(stdout.trim())?.[1];
      if (!version) return { cli, login };
      Object.assign(cli, { status: 'ok', version });
      try {
        await execute(binary, ['login', 'status'], options);
        login.status = 'ok';
      } catch (error) {
        login.status = /\bnot logged in\b/i.test(error.stdout + ' ' + error.stderr) ? 'failed' : 'warning';
      }
    } catch { /* Only allowlisted status and version leave this function. */ }
    return { cli, login, sandboxMarker: cli.status === 'ok' && await checkSandboxMarker() };
  };
  return async () => {
    if (!cached || Date.now() - checkedAt >= 30000) {
      checkedAt = Date.now();
      cached = checkCli();
    }
    const { cli, login, sandboxMarker } = await cached;
    const connected = ['connected', 'resume_failed'].includes(live.connection);
    const protocol = live.protocolStatus ?? 'unchecked';
    return {
      schema: 1,
      local: { status: 'ok' },
      node: { status: 'ok', version: process.versions.node },
      cli, login,
      appServer: { status: connected ? 'ok' : live.connection === 'connecting' ? 'warning' :
        live.connectionFailure ? 'failed' : 'unchecked' },
      protocol: { status: protocol },
      sandbox: { status: live.sandboxFailure ? 'failed' : sandboxMarker ? 'warning' : 'unchecked',
        evidence: live.sandboxFailure ? 'bridge-failure' : sandboxMarker ? 'local-error-marker' : 'unverified' },
      lastFailure: live.lastFailure ?? null,
    };
  };
}
