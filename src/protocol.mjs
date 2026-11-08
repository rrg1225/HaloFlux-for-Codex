import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const APPROVAL_METHODS = Object.freeze({
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'file',
  'item/permissions/requestApproval': 'permissions',
  'item/tool/requestUserInput': 'input',
  'mcpServer/elicitation/request': 'elicitation',
});

export function stringDecisions(schema, definition) {
  const decision = schema.definitions?.[definition];
  return [decision, ...decision?.oneOf ?? []].flatMap(value => value?.enum ?? []);
}

export async function withSchema(binary, readContract) {
  const dir = await mkdtemp(join(tmpdir(), 'haloflux-schema-'));
  try {
    await execute(binary, ['app-server', 'generate-json-schema', '--experimental', '--out', dir], {
      windowsHide: true, timeout: 10000,
    });
    const read = async name => JSON.parse(await readFile(join(dir, name + '.json'), 'utf8'));
    return await readContract(read);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function safetyContract(read) {
  const schema = await read('ClientRequest');
  const definitions = schema.definitions ?? {};
  const has = (definition, fields) => fields.every(field => Object.hasOwn(definitions[definition]?.properties ?? {}, field));
  const readOnly = definitions.SandboxPolicy?.oneOf?.find(value => value.properties?.type?.enum?.includes('readOnly'));
  return has('ThreadStartParams', ['sandbox', 'approvalsReviewer']) &&
    has('ThreadResumeParams', ['sandbox', 'approvalsReviewer']) &&
    has('TurnStartParams', ['sandboxPolicy', 'approvalsReviewer']) &&
    definitions.SandboxMode?.enum?.includes('read-only') === true &&
    definitions.ApprovalsReviewer?.enum?.includes('user') === true &&
    Object.hasOwn(readOnly?.properties ?? {}, 'networkAccess');
}

export async function approvalContract(read) {
  const [command, file, permissions, input, elicitation] = await Promise.all([
    'CommandExecution', 'FileChange', 'Permissions', 'ToolRequestUserInput', 'McpServerElicitationRequest',
  ].map(name => read(name + (['CommandExecution', 'FileChange', 'Permissions'].includes(name) ? 'RequestApproval' : '') + 'Response')));
  const result = {
    command: stringDecisions(command, 'CommandExecutionApprovalDecision'),
    file: stringDecisions(file, 'FileChangeApprovalDecision'),
    permissions: Boolean(permissions.properties?.permissions && permissions.properties?.scope &&
      permissions.definitions?.PermissionGrantScope?.enum?.includes('turn')),
    input: Boolean(input.properties?.answers && input.definitions?.ToolRequestUserInputAnswer?.properties?.answers),
    elicitation: Boolean(elicitation.properties?.action && elicitation.properties?.content &&
      elicitation.properties?._meta && elicitation.definitions?.McpServerElicitationAction?.enum?.includes('decline')),
  };
  if (!result.command.length || !result.file.length) throw new Error('Unsupported approval decision schema.');
  return result;
}
