import { CodexRpc } from './codex-rpc.mjs';
import { APPROVAL_METHODS, EventAdapter } from './event-adapter.mjs';
import { createApproval, decisionResult, reviewApproval } from './approvals.mjs';
import { FAILURE, FAILURE_HINTS } from './diagnostics.mjs';

const RETRY_MS = [500, 1500, 4000];
const SAFE_THREAD = { sandbox: 'read-only', approvalsReviewer: 'user' };
const validThread = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export class ActionError extends Error {}

export class CodexSession {
  constructor({ publish, cwd, makeRpc = () => new CodexRpc({ cwd }), clock = Date.now }) {
    this.publish = publish;
    this.cwd = cwd;
    this.makeRpc = makeRpc;
    this.connection = 'disconnected';
    this.threadId = null;
    this.rpc = null;
    this.draining = new Set();
    this.retry = 0;
    this.busy = false;
    this.clock = clock;
    this.adapter = new EventAdapter(() => this.emit(), { clock });
    this.expiry = setInterval(() => this.expireApprovals(), 500).unref();
  }

  get snapshot() {
    return {
      ...this.adapter.snapshot,
      connection: this.connection,
      hasThread: this.threadId !== null,
      busy: this.busy,
      interrupting: this.interrupting != null,
    };
  }

  noteFailure(category) {
    if (!Object.values(FAILURE).includes(category)) return;
    this.lastFailure = category;
    if (category === FAILURE.sandbox) this.sandboxFailure = true;
  }

  emit() {
    if (!this.adapter) return;
    if (this.adapter.failure !== this.observedFailure) {
      this.observedFailure = this.adapter.failure;
      this.noteFailure(this.observedFailure);
    }
    this.publish(this.snapshot);
  }

  async connect() {
    if (this.stopped || this.rpc || this.connection === 'connecting') return;
    clearTimeout(this.retryTimer);
    this.connection = 'connecting';
    this.emit();
    let rpc;
    try {
      rpc = this.rpc = this.makeRpc();
      this.seenRequests = new Set();
      rpc.on('closed', category => this.disconnected(rpc, category));
      rpc.on('notification', ({ method, params }) => {
        if (this.rpc !== rpc) return;
        if (method === 'turn/started' && !this.adapter.turnId && !this.starting && !this.resuming) return;
        if (this.interrupting && method === 'turn/completed' && params?.threadId === this.adapter.threadId &&
          params.turn?.id === this.interrupting && ['completed', 'failed', 'interrupted'].includes(params.turn.status)) {
          this.interrupting = null;
        }
        this.adapter.notify(method, params);
        if (method === 'turn/started' && this.adapter.turnId && this.starting) {
          for (const request of this.starting.splice(0)) this.registerApproval(rpc, request);
        }
      });
      rpc.on('request', request => this.serverRequest(rpc, request));
      await rpc.initialize();
      if (this.rpc !== rpc) return;
      if (rpc.safetyContract === false) {
        this.disconnected(rpc, FAILURE.protocol);
        return;
      }
      const contract = rpc.approvalContract;
      this.protocolStatus = contract?.permissions && contract.input && contract.elicitation ? 'ok' : 'warning';
      if (this.threadId) {
        try {
          await this.resume(rpc, this.threadId);
        } catch (error) {
          if (this.rpc !== rpc) throw error;
          this.noteFailure(error.category ?? FAILURE.environment);
          this.threadId = null;
          this.restoreTurnId = null;
          this.connection = 'resume_failed';
          this.adapter.reset(null);
          return;
        }
      }
      this.retry = 0;
      this.connectionFailure = null;
      this.connection = 'connected';
      this.emit();
    } catch (error) {
      this.disconnected(rpc, error.category);
    }
  }

  disconnected(rpc, category = FAILURE.environment) {
    if (rpc && this.rpc !== rpc) return;
    this.rpc = null;
    const closing = rpc?.close();
    if (closing) {
      this.draining.add(closing);
      const forget = () => this.draining.delete(closing);
      void closing.then(forget, forget);
    }
    if (this.stopped) return;
    this.noteFailure(category);
    if (category === FAILURE.protocol) this.protocolStatus = 'failed';
    this.connectionFailure = category;
    this.restoreTurnId ??= this.adapter.turnId;
    this.interrupting = null;
    this.connection = 'disconnected';
    this.adapter.reset(this.threadId);
    if (![FAILURE.protocol, FAILURE.cliMissing, FAILURE.cliPath].includes(category) && this.retry < RETRY_MS.length) {
      this.retryTimer = setTimeout(() => this.connect(), RETRY_MS[this.retry++]);
      this.retryTimer.unref?.();
    }
  }

  async resume(rpc, id) {
    this.adapter.reset(id);
    const queued = this.resuming = [];
    let restored = false;
    try {
      const { thread } = await rpc.call('thread/resume', { threadId: id, excludeTurns: true, ...SAFE_THREAD });
      if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
      if (thread?.id !== id || typeof thread.status?.type !== 'string') {
        const error = new Error('Unexpected Codex thread.');
        error.category = FAILURE.protocol;
        throw error;
      }
      if (thread.status.type === 'active' || this.restoreTurnId) {
        const { data } = await rpc.call('thread/turns/list', {
          threadId: id, limit: 1, sortDirection: 'desc', itemsView: 'summary',
        });
        if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
        const turn = data[0];
        if (turn?.status === 'inProgress' && thread.status.type === 'active') {
          this.adapter.startTurn(turn.id);
          if (this.adapter.turnId === turn.id) {
            for (const item of turn.items) {
              if (item.status === 'inProgress') this.adapter.item(false, item);
            }
          }
        } else if (this.restoreTurnId && !this.adapter.turnId) {
          const outcome = turn?.id === this.restoreTurnId && ['completed', 'failed', 'interrupted'].includes(turn.status)
            ? turn.status : 'unknown';
          this.adapter.finishTurn(this.restoreTurnId, outcome);
        }
      }
      this.restoreTurnId = null;
      this.threadId = id;
      restored = true;
    } finally {
      if (this.resuming === queued) this.resuming = null;
      for (const request of queued) {
        if (this.rpc !== rpc) break;
        if (restored) this.registerApproval(rpc, request);
        else this.reject(rpc, request.id);
      }
    }
  }

  async action(body) {
    const { action, threadId, prompt, cursor } = body;
    if (action === 'connect') {
      this.retry = 0;
      await this.connect();
      if (this.connection === 'resume_failed') this.connection = 'connected';
      this.emit();
      if (this.connection !== 'connected') throw new ActionError(FAILURE_HINTS[this.connectionFailure] ??
        '无法连接 Codex。请检查 CLI、登录状态及 App Server。');
      return {};
    }
    const rpc = this.rpc;
    if (!rpc || !['connected', 'resume_failed'].includes(this.connection)) {
      throw new ActionError('Codex 尚未连接。');
    }
    if (action === 'context') return { threadId: this.threadId, approvals: body.review === true ? this.reviews() : [] };
    if (action === 'details') return { task: await this.taskDetail(rpc) };
    if (action === 'threads') return this.listThreads(rpc, cursor);
    if (action === 'decision') {
      this.decide(rpc, body);
      return {};
    }
    if (action === 'interrupt') {
      if (!this.adapter.turnConfirmed || this.interrupting) throw new ActionError('当前没有可中断的任务。');
      const turnId = this.adapter.turnId;
      this.interrupting = turnId;
      this.emit();
      try {
        await rpc.call('turn/interrupt', { threadId: this.adapter.threadId, turnId });
      } catch (error) {
        if (this.rpc !== rpc) throw error;
        if (this.adapter.turnId === turnId) {
          for (const entry of this.adapter.approvals.values()) this.deny(rpc, entry, 'closed');
          this.interrupting = null;
          this.emit();
          throw error;
        }
        if (!this.adapter.finishedTurns.has(turnId)) throw error;
      }
      return {};
    }
    if (!['new', 'resume', 'run'].includes(action)) throw new ActionError('未知操作。');
    if (this.busy || this.adapter.turnId) throw new ActionError('请等待当前任务结束。');
    this.busy = true;
    this.emit();
    const previousThread = this.threadId;
    try {
      if (action === 'new') {
        const { thread } = await rpc.call('thread/start', { cwd: this.cwd, ...SAFE_THREAD });
        if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
        this.threadId = thread.id;
        this.adapter.reset(thread.id);
      } else if (action === 'resume') {
        if (!validThread(threadId)) {
          throw new ActionError('请输入有效的线程 ID。');
        }
        try {
          await this.resume(rpc, threadId);
        } catch (error) {
          if (this.rpc === rpc) this.adapter.reset(this.threadId);
          throw error;
        }
      } else {
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) {
          throw new ActionError('请输入 1 至 12000 字符的任务。');
        }
        if (!this.threadId) {
          const { thread } = await rpc.call('thread/start', { cwd: this.cwd, ...SAFE_THREAD });
          if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
          this.threadId = thread.id;
          this.adapter.reset(thread.id);
        }
        this.starting = [];
        this.adapter.prompt = prompt;
        const { turn } = await rpc.call('turn/start', {
          threadId: this.threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
          approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false },
        });
        if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
        // The RPC can reply before Codex begins the turn and permits interruption.
        if (turn.status === 'inProgress') this.adapter.startTurn(turn.id, false);
        else if (['completed', 'failed', 'interrupted'].includes(turn.status)) {
          this.adapter.startTurn(turn.id, false);
          this.adapter.finishTurn(turn.id, turn.status, turn.error);
        }
      }
      if (previousThread && previousThread !== this.threadId) {
        // Local scope changes first, so late events from the old subscription are ignored.
        try { await rpc.call('thread/unsubscribe', { threadId: previousThread }); } catch { /* older server or lost transport */ }
      }
      if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
      this.connection = 'connected';
      return { threadId: this.threadId };
    } finally {
      if (this.starting && this.rpc === rpc) {
        for (const request of this.starting) this.registerApproval(rpc, request);
      }
      this.starting = null;
      this.adapter.prompt = null;
      this.busy = false;
      this.emit();
    }
  }

  serverRequest(rpc, { id, method, params }) {
    if (this.rpc !== rpc) return;
    if (!(typeof id === 'string' || Number.isSafeInteger(id)) || this.seenRequests.has(id)) return;
    if (this.seenRequests.size >= 10000) return rpc.close();
    this.seenRequests.add(id);
    if (!Object.hasOwn(APPROVAL_METHODS, method) || !validThread(params?.threadId) ||
      params.threadId !== this.adapter.threadId ||
      JSON.stringify(params).length > 128 * 1024) {
      this.reject(rpc, id);
      return;
    }
    const request = createApproval(id, method, params, rpc.approvalContract, this.clock());
    if (request.kind === 'elicitation' && params.turnId === null) return this.deny(rpc, request, 'closed');
    if (!validThread(params.turnId)) return this.reject(rpc, id);
    const queue = this.resuming ?? this.starting;
    if (queue && !this.adapter.turnId) {
      if (queue.length < 32) queue.push(request);
      else this.reject(rpc, id);
    } else {
      this.registerApproval(rpc, request);
    }
  }

  registerApproval(rpc, entry) {
    if (this.rpc !== rpc) return;
    const { threadId, turnId, itemId } = entry.params;
    if (this.adapter.resolved.has(entry.id)) return;
    if (threadId !== this.adapter.threadId || turnId !== this.adapter.turnId ||
      this.adapter.finishedItems.has(itemId) || this.adapter.approvals.size >= 32) return this.reject(rpc, entry.id);
    if (this.interrupting || this.adapter.fatal || entry.expiresAt <= this.clock()) return this.deny(rpc, entry, 'closed');
    this.adapter.approval(entry.id, entry.kind, turnId, entry);
  }

  reject(rpc, id) {
    try { rpc.send({ id, error: { code: -32601, message: 'Request unavailable in HaloFlux.' } }); } catch { rpc.close(); }
  }

  review(entry) {
    return reviewApproval(entry, this.adapter.proposals.get(entry.params.itemId));
  }

  reviews() {
    this.expireApprovals();
    if (this.interrupting || this.adapter.fatal || this.resuming) return [];
    return [...this.adapter.approvals.values()].map(entry => this.review(entry));
  }

  decide(rpc, { requestId, threadId, turnId, ticket, decision, answers }) {
    this.expireApprovals();
    const entry = this.adapter.approvals.get(requestId);
    if (this.rpc !== rpc || !entry || this.interrupting || this.adapter.fatal || this.resuming ||
      threadId !== this.threadId || threadId !== entry.params.threadId || turnId !== this.adapter.turnId ||
      turnId !== entry.params.turnId) throw new ActionError('该请求已结束或失效。');
    const view = this.review(entry);
    if (ticket !== view.ticket) throw new ActionError('审批内容已变化或失效，请重新查看。');
    const payload = decisionResult(entry, view, decision, answers);
    if (!payload) throw new ActionError('该决定不可用，或答案不完整。');
    this.respond(rpc, entry, payload, decision);
  }

  respond(rpc, entry, payload, status) {
    // Consume before writing to stdio. A failed write must never be retried.
    this.adapter.resolveApproval(entry.id, status);
    try { rpc.send({ id: entry.id, ...payload }); } catch (error) { rpc.close(); throw error; }
  }

  deny(rpc, entry, status) {
    const view = this.review(entry);
    const denial = view.decisions.find(value => ['decline', 'cancel', 'reject'].includes(value));
    try { this.respond(rpc, entry, decisionResult(entry, view, denial), status); } catch { /* transport closed */ }
  }

  expireApprovals() {
    const rpc = this.rpc;
    if (!rpc) return;
    for (const entry of this.adapter.approvals.values()) {
      if (this.adapter.finishedItems.has(entry.params.itemId)) {
        this.adapter.resolveApproval(entry.id, 'closed');
      } else if (entry.expiresAt <= this.clock()) {
        this.deny(rpc, entry, 'expired');
      }
    }
  }

  async listThreads(rpc, cursor) {
    if (cursor != null && (typeof cursor !== 'string' || cursor.length > 8192)) throw new ActionError('分页参数无效。');
    const { data, nextCursor } = await rpc.call('thread/list', { cursor, limit: 25 });
    if (this.rpc !== rpc) throw new ActionError('Codex 已断开。');
    return { threads: data.map(thread => ({
      id: thread.id, name: thread.name?.slice(0, 160), updatedAt: thread.updatedAt,
    })), nextCursor };
  }

  async taskDetail(rpc) {
    const current = this.adapter.taskDetail();
    if (current || !this.threadId || this.busy || this.adapter.turnId) return current;
    const id = this.threadId;
    const { data } = await rpc.call('thread/turns/list', {
      threadId: id, limit: 1, sortDirection: 'desc', itemsView: 'full',
    });
    if (this.rpc !== rpc || this.threadId !== id) throw new ActionError('线程已切换。');
    const turn = data[0];
    if (!turn) return null;
    return {
      threadId: id, turnId: turn.id, historical: true, outcome: turn.status, timeline: [],
      error: turn.error?.message?.slice(0, 32000),
      prompt: turn.items.filter(i => i.type === 'userMessage').flatMap(i => i.content)
        .filter(i => i.type === 'text').map(i => i.text).join('\n').slice(0, 32000),
      reply: turn.items.filter(i => i.type === 'agentMessage' && i.phase !== 'commentary')
        .map(i => i.text).join('\n\n').slice(-32000),
    };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.expiry);
    clearTimeout(this.retryTimer);
    clearTimeout(this.adapter.timer);
    const rpc = this.rpc;
    this.rpc = null;
    return Promise.all([...this.draining, rpc?.close()]);
  }
}
