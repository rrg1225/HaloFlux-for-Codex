// Minimal schema data at the binary boundary. Contract checks and JSONL handshakes stay real.
const methods = (...names) => ({ oneOf: names.map(name => ({ properties: { method: { enum: [name] } } })) });
const fields = (...names) => ({ properties: Object.fromEntries(names.map(name => [name, {}])) });
const ref = name => ({ $ref: '#/definitions/' + name });
const safetyMethods = [
  ['thread/start', 'ThreadStartParams', 'sandbox', 'SandboxMode'],
  ['thread/resume', 'ThreadResumeParams', 'sandbox', 'SandboxMode'],
  ['turn/start', 'TurnStartParams', 'sandboxPolicy', 'SandboxPolicy'],
];
const schemas = {
  ClientRequest: {
    oneOf: [
      ...methods('initialize', 'thread/list', 'thread/unsubscribe', 'thread/turns/list', 'turn/interrupt').oneOf,
      ...safetyMethods.map(([method, name]) => ({ properties: { method: { enum: [method] }, params: ref(name) } })),
    ],
    definitions: {
      ...Object.fromEntries(safetyMethods.map(([, name, field, type]) => [name, {
        properties: { [field]: { anyOf: [ref(type), { type: 'null' }] }, approvalsReviewer: ref('ApprovalsReviewer') },
      }])),
      SandboxMode: { enum: ['read-only'] },
      ApprovalsReviewer: { enum: ['user'] },
      SandboxPolicy: { oneOf: [{ properties: { type: { enum: ['readOnly'] }, networkAccess: { type: 'boolean' } } }] },
    },
  },
  ClientNotification: methods('initialized'),
  ServerNotification: methods('turn/started', 'turn/completed', 'item/started', 'item/completed'),
  CommandExecutionRequestApprovalResponse: { definitions: { CommandExecutionApprovalDecision: { enum: ['accept', 'decline'] } } },
  FileChangeRequestApprovalResponse: { definitions: { FileChangeApprovalDecision: { enum: ['accept', 'decline'] } } },
  PermissionsRequestApprovalResponse: { ...fields('permissions', 'scope'),
    definitions: { PermissionGrantScope: { enum: ['turn'] } } },
  ToolRequestUserInputResponse: { ...fields('answers'), definitions: { ToolRequestUserInputAnswer: fields('answers') } },
  McpServerElicitationRequestResponse: { ...fields('action', 'content', '_meta'),
    definitions: { McpServerElicitationAction: { enum: ['decline'] } } },
};

export function fixtureSchema(overrides = {}) {
  return async (_command, inspect) => inspect(name => structuredClone(overrides[name] ?? schemas[name]));
}
