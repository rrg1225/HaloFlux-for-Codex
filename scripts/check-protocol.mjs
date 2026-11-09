import assert from 'node:assert/strict';
import { codexBinary } from '../src/codex-rpc.mjs';
import { cliVersion } from '../src/diagnostics.mjs';
import { APPROVAL_METHODS, ITEM_TYPES } from '../src/event-adapter.mjs';
import { approvalContract, coreContract, withSchema } from '../src/protocol.mjs';

const codex = codexBinary();
const version = await cliVersion(codex);
await withSchema(codex, async read => {
  assert.equal(await coreContract(read), true, 'core methods and read-only, network-disabled, human-review contract');
  const client = await read('ClientRequest');
  const notifications = await read('ServerNotification');
  const requests = await read('ServerRequest');
  const v2 = (await read('codex_app_server_protocol.v2.schemas')).definitions;
  function methods(schema, names) {
    for (const name of names) {
      assert.ok(schema.oneOf.some(variant => variant.properties?.method?.enum?.includes(name)), name);
    }
  }
  function fields(schema, names) {
    assert.ok(schema, 'Missing schema');
    for (const name of names) assert.ok(Object.hasOwn(schema.properties, name), name);
  }
  methods(client, ['initialize', 'thread/start', 'thread/list', 'thread/resume', 'thread/unsubscribe',
    'thread/turns/list', 'turn/start', 'turn/interrupt']);
  methods(await read('ClientNotification'), ['initialized']);
  methods(notifications, ['turn/started', 'turn/completed', 'item/started', 'item/completed',
    'item/agentMessage/delta', 'item/fileChange/patchUpdated', 'error', 'serverRequest/resolved']);
  methods(requests, Object.keys(APPROVAL_METHODS));
  fields(client.definitions.InitializeParams, ['clientInfo', 'capabilities']);
  fields(client.definitions.ThreadStartParams, ['cwd', 'sandbox', 'approvalsReviewer']);
  fields(client.definitions.ThreadResumeParams, ['threadId', 'excludeTurns', 'sandbox', 'approvalsReviewer']);
  fields(client.definitions.ThreadListParams, ['cursor', 'limit']);
  fields(await read('v2/ThreadListResponse'), ['data', 'nextCursor']);
  fields(client.definitions.ThreadTurnsListParams, ['threadId', 'limit', 'sortDirection', 'itemsView']);
  fields(client.definitions.TurnStartParams, ['threadId', 'input', 'sandboxPolicy', 'approvalsReviewer']);
  fields(client.definitions.SandboxPolicy.oneOf.find(v => v.properties.type.enum.includes('readOnly')), ['networkAccess']);
  fields(client.definitions.TurnInterruptParams, ['threadId', 'turnId']);
  const text = client.definitions.UserInput.oneOf.find(variant => variant.properties?.type?.enum?.includes('text'));
  fields(text, ['text', 'text_elements']);
  fields(v2.Thread, ['id', 'status', 'turns']);
  fields(v2.ThreadTurnsListResponse, ['data']);
  fields(v2.Turn, ['id', 'status', 'items']);
  for (const status of ['completed', 'interrupted', 'failed', 'inProgress']) assert.ok(v2.TurnStatus.enum.includes(status), status);
  fields(v2.TurnStartedNotification, ['threadId', 'turn']);
  fields(v2.TurnCompletedNotification, ['threadId', 'turn']);
  fields(v2.ItemStartedNotification, ['threadId', 'turnId', 'item']);
  fields(v2.ItemCompletedNotification, ['threadId', 'turnId', 'item']);
  fields(v2.AgentMessageDeltaNotification, ['threadId', 'turnId', 'itemId', 'delta']);
  fields(v2.ErrorNotification, ['threadId', 'turnId', 'willRetry']);
  fields(v2.ServerRequestResolvedNotification, ['threadId', 'requestId']);
  for (const type of Object.keys(ITEM_TYPES)) {
    const schema = v2.ThreadItem.oneOf.find(variant => variant.properties?.type?.enum?.includes(type));
    fields(schema, ['id']);
    if (type === 'fileChange' || type === 'commandExecution') fields(schema, ['status']);
    if (type === 'commandExecution') fields(schema, ['command', 'exitCode', 'aggregatedOutput']);
  }
  const command = await read('CommandExecutionRequestApprovalParams');
  fields(command, ['threadId', 'turnId', 'itemId', 'startedAtMs', 'command', 'cwd',
    'availableDecisions', 'networkApprovalContext', 'additionalPermissions']);
  fields(await read('FileChangeRequestApprovalParams'), ['threadId', 'turnId', 'itemId', 'startedAtMs', 'grantRoot']);
  fields(await read('v2/FileChangePatchUpdatedNotification'), ['threadId', 'turnId', 'itemId', 'changes']);
  fields(v2.FileUpdateChange, ['path', 'kind', 'diff']);
  fields(v2.TurnError, ['message', 'codexErrorInfo']);
  fields(command.definitions.NetworkApprovalContext, ['host', 'protocol']);
  assert.deepEqual(command.definitions.NetworkApprovalProtocol.enum, ['http', 'https', 'socks5Tcp', 'socks5Udp']);
  fields(await read('PermissionsRequestApprovalParams'), ['threadId', 'turnId', 'itemId', 'startedAtMs', 'cwd', 'permissions']);
  const input = await read('ToolRequestUserInputParams');
  fields(input, ['threadId', 'turnId', 'itemId', 'questions', 'isBlocking', 'autoResolutionMs']);
  fields(input.definitions.ToolRequestUserInputQuestion, ['id', 'header', 'question', 'isOther', 'isSecret', 'options']);
  const mcp = await read('McpServerElicitationRequestParams');
  fields(mcp, ['threadId', 'turnId', 'serverName']);
  assert.ok(mcp.properties.turnId.type.includes('null'), 'unscoped MCP elicitation');
  const decisions = await approvalContract(read);
  for (const kind of ['command', 'file']) for (const value of ['accept', 'decline', 'cancel']) {
    assert.ok(decisions[kind].includes(value), kind + ' ' + value);
  }
  for (const kind of ['permissions', 'input', 'elicitation']) assert.equal(decisions[kind], true, kind);
  fields(await read('PermissionsRequestApprovalResponse'), ['permissions', 'scope']);
  fields(await read('ToolRequestUserInputResponse'), ['answers']);
  fields(await read('McpServerElicitationRequestResponse'), ['action', 'content', '_meta']);
});
console.log('codex-cli ' + version + ' | HaloFlux protocol contract verified.');
