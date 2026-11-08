import assert from 'node:assert/strict';
import test from 'node:test';
import { codexFailure, FAILURE } from '../src/diagnostics.mjs';
import { RESULT, verifyExecution } from '../scripts/test-results.mjs';

test('classifies the Windows setup marker without treating every helper error as a refresh failure', () => {
  assert.equal(codexFailure({ code: 'helper_unknown_error', message: 'setup refresh had errors' }), FAILURE.sandbox);
  assert.equal(codexFailure({ code: 'helper_unknown_error', message: 'different error' }), FAILURE.environment);
});

test('execution requires successful exit and a marker on its own line', () => {
  const probe = { exitCode: 0, stdout: 'HALOFLUX_TEST\r\n', expected: 'HALOFLUX_TEST' };
  assert.equal(verifyExecution(probe), RESULT.execution);
  assert.equal(verifyExecution({ ...probe, stdout: 'echo HALOFLUX_TEST' }), RESULT.failure);
  assert.equal(verifyExecution({ ...probe, exitCode: null }), RESULT.failure);
  assert.equal(verifyExecution({ ...probe, exitCode: 1 }), RESULT.failure);
  assert.equal(verifyExecution({ ...probe, environmentBlocked: true }), RESULT.blocked);
});
