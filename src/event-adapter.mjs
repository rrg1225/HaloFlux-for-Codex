import { approvalProposal } from './approvals.mjs';
import { codexFailure, FAILURE } from './diagnostics.mjs';
export { APPROVAL_METHODS } from './protocol.mjs';

export const ITEM_TYPES = Object.freeze({
  commandExecution: 'command',
  fileChange: 'file',
  agentMessage: 'message',
  mcpToolCall: 'tool',
  dynamicToolCall: 'tool',
  webSearch: 'tool',
});

function remember(set, id) {
  if (set.has(id)) return false;
  set.add(id);
  if (set.size > 1024) set.delete(set.values().next().value);
  return true;
}

const detailText = value => typeof value === 'string' ? value.slice(0, 32000) : null;
const statuses = ['completed', 'failed', 'declined', 'interrupted'];

export class EventAdapter {
  constructor(publish, { linger = 2600, clock = Date.now } = {}) {
    this.publish = publish;
    this.clock = clock;
    this.linger = linger;
    this.pulse = 0;
    this.detailRevision = 0;
    this.scopeRevision = 0;
    this.finishedTurns = new Set();
    this.reset(null);
  }

  reset(threadId) {
    clearTimeout(this.timer);
    this.scopeRevision++;
    this.threadId = threadId;
    this.turnId = null;
    this.turnConfirmed = false;
    this.items = new Map();
    this.finishedItems = new Set();
    this.proposals = new Map();
    this.approvals = new Map();
    this.resolved = new Set();
    this.terminal = null;
    this.fatal = false;
    this.failure = null;
    this.outcome = null;
    this.activity = null;
    this.activityResult = null;
    this.lastDelta = -Infinity;
    this.streaming = false;
    this.counts = { command: 0, file: 0, tool: 0, message: 0 };
    this.detail = null;
    this.prompt = null;
    this.messages = new Map();
    this.detailRevision++;
    this.emit();
  }

  get snapshot() {
    const active = [...this.items.values()];
    const activeKinds = active.filter(kind => kind !== 'message');
    const tools = activeKinds.length;
    let state = this.turnId ? 'working' : this.terminal ?? 'idle';
    if (this.streaming) state = 'streaming';
    if (tools) state = 'tool_running';
    if (this.approvals.size) state = 'approval_required';
    if (this.fatal) state = 'failed';
    return {
      state, activity: this.activity, activityResult: this.activityResult,
      activeKind: activeKinds.at(-1) ?? null,
      pulse: this.pulse, active: this.turnId !== null, canInterrupt: this.turnConfirmed, activeTools: tools,
      outcome: this.outcome, counts: { ...this.counts },
      approvals: [...this.approvals.values()].map(({ kind, displayKind }) => ({ kind: displayKind ?? kind })),
      detailRevision: this.detailRevision,
      scopeRevision: this.scopeRevision,
      failure: this.failure,
    };
  }

  emit() { this.publish(this.snapshot); }

  record(event, kind = null, status = null) {
    if (!this.detail) return;
    if (this.detail.timeline.length >= 200) this.detail.timeline.splice(1, 1);
    this.detail.timeline.push({ event, kind, status, at: this.clock() });
    this.detailRevision++;
  }

  taskDetail() {
    return this.detail && {
      ...this.detail,
      timeline: [...this.detail.timeline],
      reply: [...this.messages.values()].filter(m => m.phase !== 'commentary').map(m => m.text).join('\n\n').slice(-32000),
    };
  }

  proposal(itemId, proposal, update = false) {
    if (typeof itemId !== 'string' || this.finishedItems.has(itemId) ||
      (!update && this.proposals.has(itemId))) return;
    if (this.proposals.size >= 32 && !this.proposals.has(itemId)) this.proposals.delete(this.proposals.keys().next().value);
    this.proposals.set(itemId, approvalProposal(proposal));
  }

  message(itemId, value, complete = false, phase = null) {
    if (typeof itemId !== 'string' || typeof value !== 'string') return;
    if (this.messages.size >= 12 && !this.messages.has(itemId)) this.messages.delete(this.messages.keys().next().value);
    const previous = this.messages.get(itemId);
    const text = complete ? detailText(value) : detailText((previous?.text ?? '') + value.slice(0, 32000));
    this.messages.set(itemId, { text, phase: phase ?? previous?.phase });
    this.detailRevision++;
  }

  startTurn(turnId, confirmed = true) {
    if (!this.threadId || typeof turnId !== 'string' || this.finishedTurns.has(turnId)) return;
    if (this.turnId) {
      if (turnId === this.turnId && confirmed && !this.turnConfirmed) {
        this.turnConfirmed = true;
        this.emit();
      }
      return;
    }
    clearTimeout(this.timer);
    this.turnId = turnId;
    this.turnConfirmed = confirmed;
    this.items.clear();
    this.proposals.clear();
    this.finishedItems.clear();
    this.terminal = null;
    this.fatal = false;
    this.failure = null;
    this.outcome = null;
    this.activity = null;
    this.activityResult = null;
    this.lastDelta = -Infinity;
    this.streaming = false;
    this.counts = { command: 0, file: 0, tool: 0, message: 0 };
    this.messages.clear();
    this.detail = { threadId: this.threadId, turnId, prompt: this.prompt, outcome: null, error: null, timeline: [] };
    this.prompt = null;
    this.record('turn-started');
    this.emit();
  }

  finishTurn(turnId, outcome, error) {
    if (typeof turnId !== 'string' || (this.turnId && this.turnId !== turnId)) return;
    if (!remember(this.finishedTurns, turnId)) return;
    clearTimeout(this.timer);
    this.turnId = null;
    this.turnConfirmed = false;
    this.items.clear();
    this.proposals.clear();
    for (const request of this.approvals.values()) this.record('approval-result', request.displayKind ?? request.kind, 'closed');
    this.approvals.clear();
    this.streaming = false;
    this.fatal = false;
    this.terminal = ['failed', 'completed', 'interrupted'].includes(outcome) ? outcome : 'idle';
    this.outcome = outcome;
    if (this.detail?.turnId === turnId) {
      this.detail.outcome = outcome;
      this.detail.error = detailText(error?.message) ?? this.detail.error;
      if (outcome === 'failed') {
        const category = codexFailure(error ?? {});
        if (!this.failure || category !== FAILURE.environment) this.failure = category;
      }
      this.record('turn-completed', null, outcome);
    }
    this.activity = null;
    this.activityResult = null;
    this.pulse++;
    this.emit();
    this.timer = setTimeout(() => {
      this.terminal = null;
      this.emit();
    }, this.linger);
    this.timer.unref?.();
  }

  notify(method, p) {
    if (!this.threadId || p?.threadId !== this.threadId) return;
    if (method === 'serverRequest/resolved') {
      remember(this.resolved, p.requestId);
      this.resolveApproval(p.requestId, 'closed');
      return;
    }
    if (method === 'turn/started') {
      this.startTurn(p.turn?.id);
      return;
    }
    if (method === 'turn/completed') {
      if (this.turnId && ['completed', 'failed', 'interrupted'].includes(p.turn?.status)) {
        this.finishTurn(p.turn.id, p.turn.status, p.turn.error);
      }
      return;
    }
    if (!this.turnId || p.turnId !== this.turnId) return;
    if (method === 'error' && p.willRetry === false) {
      if (this.fatal) return;
      this.fatal = true;
      this.failure = codexFailure(p.error ?? {});
      this.detail.error = detailText(p.error?.message);
      this.record('error', null, 'failed');
      this.pulse++;
      this.emit();
    } else if (method === 'item/started' || method === 'item/completed') {
      this.item(method === 'item/completed', p.item);
    } else if (method === 'item/fileChange/patchUpdated' && !this.finishedItems.has(p.itemId)) {
      this.proposal(p.itemId, { type: 'fileChange', changes: p.changes }, true);
      this.detailRevision++;
      this.emit();
    } else if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      if (this.finishedItems.has(p.itemId)) return;
      this.message(p.itemId, p.delta);
      const now = this.clock();
      // Deltas have no sequence number. Coalesce pulses by time, not by text.
      if (now - this.lastDelta < 100) return;
      this.lastDelta = now;
      this.streaming = true;
      this.activity = 'message';
      this.activityResult = null;
      this.pulse++;
      this.emit();
    }
  }

  item(complete, item) {
    const kind = Object.hasOwn(ITEM_TYPES, item?.type) ? ITEM_TYPES[item.type] : null;
    if (complete && item?.type === 'userMessage' && this.detail && !this.detail.prompt && Array.isArray(item.content)) {
      this.detail.prompt = detailText(item.content.filter(entry => entry?.type === 'text').map(entry => entry.text).join('\n'));
      this.detailRevision++;
      this.emit();
    }
    if (!kind || typeof item.id !== 'string' || this.finishedItems.has(item.id)) return;
    if (complete) {
      if (kind === 'command' && item.status === 'failed') {
        const category = codexFailure({ message: typeof item.aggregatedOutput === 'string' ?
          item.aggregatedOutput.slice(0, 4096) : null });
        if (category === FAILURE.sandbox) this.failure = category;
      }
      remember(this.finishedItems, item.id);
      this.proposals.delete(item.id);
      if (!this.items.delete(item.id)) this.counts[kind]++;
      if (kind === 'message') this.streaming = false;
    } else {
      if (this.items.has(item.id) || this.items.size >= 256) return;
      this.items.set(item.id, kind);
      this.counts[kind]++;
      if (kind === 'command') this.proposal(item.id, { type: item.type, command: item.command, cwd: item.cwd });
      if (kind === 'file') this.proposal(item.id, { type: item.type, changes: item.changes });
    }
    if (kind === 'message') this.message(item.id, item.text, complete, item.phase);
    this.activity = kind;
    this.activityResult = complete
      ? (statuses.includes(item.status) ? item.status : null)
      : null;
    this.record(complete ? 'item-completed' : 'item-started', kind, this.activityResult);
    this.pulse++;
    this.emit();
  }

  approval(id, kind, turnId, request) {
    if (!this.turnId || this.turnId !== turnId || this.resolved.has(id) || this.approvals.has(id)) return;
    this.approvals.set(id, { ...request, kind });
    this.record('approval-request', request?.displayKind ?? kind);
    this.emit();
  }

  resolveApproval(id, status) {
    const entry = this.approvals.get(id);
    if (!entry) return;
    remember(this.resolved, id);
    this.approvals.delete(id);
    this.record('approval-result', entry.displayKind ?? entry.kind, status);
    this.emit();
  }
}
