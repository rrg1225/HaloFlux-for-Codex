import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codexBinary } from '../src/codex-rpc.mjs';
import { createHealthCheck, FAILURE } from '../src/diagnostics.mjs';

test('CLI resolution rejects an implicit working-directory executable and invalid explicit overrides', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'haloflux-path-test-')));
  const original = { cwd: process.cwd(), PATH: process.env.PATH, CODEX_BIN: process.env.CODEX_BIN };
  const filename = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const fake = join(workspace, filename);
  try {
    await writeFile(fake, '', { mode: 0o700 });
    process.chdir(workspace);
    process.env.PATH = '.';
    delete process.env.CODEX_BIN;
    assert.throws(codexBinary, { category: FAILURE.cliMissing });
    process.env.CODEX_BIN = filename;
    assert.throws(codexBinary, { category: FAILURE.cliPath });
    process.env.CODEX_BIN = workspace;
    assert.throws(codexBinary, { category: FAILURE.cliPath });
    if (process.platform === 'win32') {
      process.env.CODEX_BIN = '\\\\invalid.invalid\\share\\codex.exe';
      assert.throws(codexBinary, { category: FAILURE.cliPath });
    }
    process.env.CODEX_BIN = fake;
    assert.equal(codexBinary(), fake);
  } finally {
    process.chdir(original.cwd);
    for (const key of ['PATH', 'CODEX_BIN']) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('health distinguishes missing CLI and invalid path without exporting raw errors', async () => {
  for (const [category, evidence] of [[FAILURE.cliMissing, 'missing'], [FAILURE.cliPath, 'invalid-path']]) {
    const health = await createHealthCheck(() => {
      throw Object.assign(new Error('PRIVATE_PATH PRIVATE_LOGIN'), { category });
    }, { protocolStatus: 'failed', connectionFailure: category, lastFailure: category })();
    assert.deepEqual(health.cli, { status: 'failed', evidence });
    assert.equal(health.login.status, 'unchecked');
    assert.equal(health.appServer.status, 'failed');
    assert.equal(health.protocol.status, 'failed');
    assert.doesNotMatch(JSON.stringify(health), /PRIVATE_/);
  }
});
