export const RESULT = Object.freeze({
  protocol: 'PROTOCOL_PASS',
  execution: 'EXECUTION_PASS',
  handled: 'EXPECTED_FAILURE_HANDLED',
  blocked: 'ENVIRONMENT_BLOCKED',
  failure: 'TEST_FAILURE',
  skipped: 'NOT_TESTED',
});

export function verifyExecution({ exitCode, stdout, expected, environmentBlocked = false }) {
  if (environmentBlocked) return RESULT.blocked;
  return exitCode === 0 && typeof stdout === 'string' &&
    stdout.split(/\r?\n/).some(line => line.trim() === expected) ? RESULT.execution : RESULT.failure;
}
