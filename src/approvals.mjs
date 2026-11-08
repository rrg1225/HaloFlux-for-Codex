import { randomUUID } from 'node:crypto';
import { APPROVAL_METHODS } from './protocol.mjs';

const LIMIT = 64 * 1024;
const TTL = 120000;
const text = (value, max = LIMIT) => typeof value === 'string' && value.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value) ? value : null;
const nonempty = (value, max) => text(value, max)?.trim() ? value : null;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function permissionPreview(value) {
  if (!record(value) || Object.keys(value).some(key => !['fileSystem', 'network'].includes(key))) return null;
  const serialized = JSON.stringify(value, null, 2);
  // Show escaped control characters as text and bound the entire permission profile.
  return text(serialized);
}

function patchPreview(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) return null;
  const preview = [];
  let size = 0;
  for (const entry of changes) {
    const path = nonempty(entry?.path, 4096);
    const type = entry?.kind?.type;
    const destination = entry?.kind?.move_path ?? null;
    const diff = text(entry?.diff);
    if (!path || !['add', 'delete', 'update'].includes(type) ||
      (destination !== null && !nonempty(destination, 4096))) return null;
    size += path.length + (destination?.length ?? 0);
    if (size > LIMIT) return null;
    const diffUnavailable = diff === null || size + diff.length > LIMIT ||
      (type === 'update' && !destination && !diff.trim());
    preview.push({ path, type, destination, diff: diffUnavailable ? null : diff });
    if (!diffUnavailable) size += diff.length;
  }
  return preview;
}

export function approvalProposal(item) {
  if (item.type === 'fileChange') return { type: item.type, files: patchPreview(item.changes) };
  return { type: item.type, command: nonempty(item.command), cwd: nonempty(item.cwd, 4096) };
}

function inputPreview(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 12) return null;
  const ids = new Set();
  const result = [];
  for (const q of questions) {
    if (!nonempty(q?.id, 128) || !nonempty(q.question, 4000) || q.isSecret || ids.has(q.id)) return null;
    const options = q.options ?? [];
    if (!Array.isArray(options) || options.length > 20 || options.some(o => !nonempty(o?.label, 256) ||
      text(o.description, 1000) === null)) return null;
    result.push({ id: q.id, header: text(q.header, 128), question: q.question, options, free: q.isOther === true || !options.length });
    ids.add(q.id);
  }
  return result;
}

export function createApproval(id, method, params, contract, now) {
  const kind = APPROVAL_METHODS[method];
  let ttl = TTL;
  if (kind === 'input' && Number.isSafeInteger(params.autoResolutionMs) && params.autoResolutionMs >= 0) {
    ttl = Math.min(ttl, params.autoResolutionMs);
  }
  const started = Number.isSafeInteger(params.startedAtMs) ? Math.min(now, params.startedAtMs) : now;
  const displayKind = kind === 'command' && params.networkApprovalContext != null ? 'network' : kind;
  return { id, kind, displayKind, params, contract, expiresAt: started + ttl, ticket: randomUUID(), preview: null };
}

export function reviewApproval(entry, proposal) {
  const { id, kind, params: p, contract, expiresAt } = entry;
  const view = {
    requestId: id, kind, threadId: p.threadId, turnId: p.turnId, expiresAt,
    reason: text(p.reason, 4000), decisions: [],
  };
  if (kind === 'file') {
    view.files = proposal?.type === 'fileChange' ? proposal.files : null;
    view.grantRoot = text(p.grantRoot, 4096);
    // grantRoot explicitly describes a potential session-wide grant.
    if (view.files?.every(file => file.diff !== null) &&
      p.grantRoot == null && contract?.file?.includes('accept')) view.decisions.push('accept');
  } else if (kind === 'command') {
    const offered = p.availableDecisions == null ? contract?.command :
      Array.isArray(p.availableDecisions) ? contract?.command?.filter(option => p.availableDecisions.includes(option)) : [];
    const context = p.networkApprovalContext;
    if (context != null) {
      view.kind = 'network';
      view.host = nonempty(context.host, 4096);
      view.protocol = ['http', 'https', 'socks5Tcp', 'socks5Udp'].includes(context.protocol) ? context.protocol : null;
      if (view.host && view.protocol && p.additionalPermissions == null && offered?.includes('accept')) view.decisions.push('accept');
    } else {
      const ordinary = (p.kind == null || p.kind === 'command') && p.approvalId == null;
      view.kind = p.kind === 'writeStdin' ? 'stdin' : 'command';
      const command = ordinary && proposal?.type === 'commandExecution' ? proposal : {};
      view.command = nonempty(p.command ?? command.command);
      view.cwd = nonempty(p.cwd ?? command.cwd, 4096);
      view.permissions = permissionPreview(p.additionalPermissions);
      if (view.kind === 'command' && (ordinary || p.kind === 'command') &&
        view.command && view.cwd && (p.additionalPermissions == null || view.permissions) &&
        offered?.includes('accept')) view.decisions.push('accept');
    }
    if (offered?.includes('decline')) view.decisions.push('decline');
    else if (offered?.includes('cancel')) view.decisions.push('cancel');
  } else if (kind === 'permissions') {
    view.cwd = nonempty(p.cwd, 4096);
    view.permissions = permissionPreview(p.permissions);
    if (contract?.permissions && view.cwd && view.permissions) view.decisions.push('accept');
  } else if (kind === 'input') {
    view.questions = inputPreview(p.questions);
    view.blocking = typeof p.isBlocking === 'boolean' ? p.isBlocking : null;
    if (contract?.input && view.questions) view.decisions.push('answer');
  } else if (kind === 'elicitation') {
    view.server = text(p.serverName, 256);
    view.reason = text(p.message, 4000);
  }
  if ((kind === 'file' && contract?.file?.includes('decline')) ||
    (['permissions', 'input', 'elicitation'].includes(kind) && contract?.[kind])) view.decisions.push('decline');
  if (!view.decisions.some(decision => ['decline', 'cancel'].includes(decision))) view.decisions.push('reject');
  const preview = JSON.stringify(view);
  if (entry.preview !== preview) {
    entry.preview = preview;
    entry.ticket = randomUUID();
  }
  return { ...view, ticket: entry.ticket };
}

export function decisionResult(entry, view, decision, answers) {
  if (!view.decisions.includes(decision)) return null;
  if (decision === 'reject') return { error: { code: -32601, message: 'Request unavailable in HaloFlux.' } };
  if (entry.kind === 'permissions') {
    return { result: { permissions: decision === 'accept' ? entry.params.permissions : {}, scope: 'turn' } };
  }
  if (entry.kind === 'elicitation') return { result: { action: 'decline', content: null, _meta: null } };
  if (entry.kind !== 'input') return { result: { decision } };
  if (decision === 'decline') return { result: { answers: {} } };
  if (!record(answers) || Object.keys(answers).length !== view.questions.length) return null;
  const entries = [];
  for (const question of view.questions) {
    if (!Object.hasOwn(answers, question.id)) return null;
    const answer = nonempty(answers[question.id], 4000);
    if (!answer || (!question.free && !question.options.some(option => option.label === answer))) return null;
    entries.push([question.id, { answers: [answer] }]);
  }
  return { result: { answers: Object.fromEntries(entries) } };
}
