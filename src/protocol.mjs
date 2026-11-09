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

export async function withSchema(binary, readContract, env = process.env, signal) {
  const dir = await mkdtemp(join(tmpdir(), 'haloflux-schema-'));
  try {
    await execute(binary, ['app-server', 'generate-json-schema', '--experimental', '--out', dir], {
      windowsHide: true, timeout: 10000, env, signal,
    });
    const read = async name => JSON.parse(await readFile(join(dir, name + '.json'), 'utf8'));
    return await readContract(read);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function coreContract(read) {
  const [client, notifications, server] = await Promise.all([
    read('ClientRequest'), read('ClientNotification'), read('ServerNotification'),
  ]);
  const hasMethods = (schema, methods) => methods.every(method =>
    schema.oneOf?.some(variant => variant.properties?.method?.enum?.includes(method)));
  return hasMethods(client, ['initialize', 'thread/start', 'thread/list', 'thread/resume',
    'thread/unsubscribe', 'thread/turns/list', 'turn/start', 'turn/interrupt']) &&
    hasMethods(notifications, ['initialized']) &&
    hasMethods(server, ['turn/started', 'turn/completed', 'item/started', 'item/completed']) &&
    await safetyContract(() => client);
}

export async function safetyContract(read) {
  const schema = await read('ClientRequest');
  const definitions = schema.definitions ?? {};
  const references = (field, type) => {
    const ref = '#/definitions/' + type;
    return field?.$ref === ref || field?.anyOf?.some(value => value?.$ref === ref) === true ||
      field?.allOf?.some(value => value?.$ref === ref) === true;
  };
  const acceptsSafetyFields = (method, definition, field, type) => {
    const request = schema.oneOf?.find(value => value.properties?.method?.enum?.includes(method));
    const params = definitions[definition]?.properties;
    return references(request?.properties?.params, definition) &&
      references(params?.[field], type) && references(params?.approvalsReviewer, 'ApprovalsReviewer');
  };
  const readOnly = definitions.SandboxPolicy?.oneOf?.find(value => value.properties?.type?.enum?.includes('readOnly'));
  const networkAccess = readOnly?.properties?.networkAccess;
  return acceptsSafetyFields('thread/start', 'ThreadStartParams', 'sandbox', 'SandboxMode') &&
    acceptsSafetyFields('thread/resume', 'ThreadResumeParams', 'sandbox', 'SandboxMode') &&
    acceptsSafetyFields('turn/start', 'TurnStartParams', 'sandboxPolicy', 'SandboxPolicy') &&
    definitions.SandboxMode?.enum?.includes('read-only') === true &&
    definitions.ApprovalsReviewer?.enum?.includes('user') === true &&
    networkAccess?.type === 'boolean' &&
    (networkAccess.enum === undefined || networkAccess.enum.includes(false)) &&
    (networkAccess.const === undefined || networkAccess.const === false);
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
