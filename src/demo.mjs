import { EventAdapter } from './event-adapter.mjs';

export class Demo {
  constructor(publish) {
    this.publish = publish;
    this.adapter = new EventAdapter(() => this.emit());
    this.adapter.reset('demo');
    this.timers = [];
    this.turn = 0;
  }

  get snapshot() {
    return { ...this.adapter.snapshot, connection: 'demo', hasThread: true, busy: false };
  }

  emit() { if (this.adapter) this.publish(this.snapshot); }

  event(method, params) {
    this.adapter.notify(method, { threadId: 'demo', turnId: this.id, ...params });
  }

  later(ms, callback) { this.timers.push(setTimeout(callback, ms)); }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    clearTimeout(this.adapter.timer);
  }

  run(scenario) {
    if (this.snapshot.active) return false;
    this.stop();
    this.adapter.reset('demo');
    this.id = 'demo-' + ++this.turn;
    this.event('turn/started', { turn: { id: this.id } });
    this.later(650, () => this.event('item/started', { item: { id: 'shell', type: 'commandExecution' } }));
    if (scenario === 'approval') {
      this.later(1350, () => this.adapter.approval(1, 'command', this.id, { token: this.id }));
    } else {
      this.later(1550, () => this.afterCommand(scenario));
    }
    return true;
  }

  afterCommand(scenario) {
    this.event('item/completed', {
      item: { id: 'shell', type: 'commandExecution', status: scenario === 'approval' ? 'declined' : 'completed' },
    });
    if (scenario === 'failure') {
      this.later(450, () => this.event('error', { willRetry: false }));
      this.later(600, () => this.finish('failed'));
      return;
    }
    if (scenario !== 'approval') {
      this.later(250, () => this.event('item/started', { item: { id: 'patch', type: 'fileChange' } }));
      this.later(1050, () => this.event('item/completed', { item: { id: 'patch', type: 'fileChange', status: 'completed' } }));
    }
    for (let ms = 1250; ms < 2600; ms += 160) {
      this.later(ms, () => this.event('item/agentMessage/delta', { itemId: 'msg', delta: '.' }));
    }
    this.later(2600, () => this.event('item/completed', { item: { id: 'msg', type: 'agentMessage' } }));
    this.later(2900, () => this.finish('completed'));
  }

  decline(token) {
    return this.decide(token, 'decline');
  }

  decide(token, decision) {
    if (!['accept', 'decline'].includes(decision) ||
      this.adapter.approvals.get(1)?.token !== token || typeof token !== 'string') return false;
    this.adapter.resolveApproval(1, decision);
    this.afterCommand(decision === 'accept' ? 'success' : 'approval');
    return true;
  }

  finish(status) {
    this.stop();
    this.event('turn/completed', { turn: { id: this.id, status } });
  }
}
