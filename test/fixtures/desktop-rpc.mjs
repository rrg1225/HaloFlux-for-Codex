import { EventEmitter } from 'node:events';

export function makeRpc() {
  return new DesktopFixture();
}

class DesktopFixture extends EventEmitter {
  sequence = 0;
  approvalContract = { command: ['accept', 'decline', 'cancel'], file: ['accept', 'decline'] };

  async initialize() {}

  async call(method, params) {
    const thread = { id: 'fixture-thread', status: { type: 'idle' } };
    if (method === 'thread/start' || method === 'thread/resume') return { thread };
    if (method === 'turn/start') {
      const turn = this.turn = { id: 'fixture-turn-' + ++this.sequence, status: 'inProgress' };
      this.emit('notification', { method: 'turn/started', params: { threadId: thread.id, turn } });
      const scenario = params.input[0].text;
      if (scenario === 'approval') {
        this.emit('request', { id: this.sequence, method: 'item/commandExecution/requestApproval',
          params: { threadId: thread.id, turnId: turn.id, itemId: 'item', cwd: 'PRIVATE_PATH', command: 'PRIVATE_COMMAND' } });
      }
      if (['completed', 'failed'].includes(scenario)) {
        this.timer = setTimeout(() => this.finish(scenario), 350);
      }
      return { turn };
    }
    if (method === 'turn/interrupt') this.finish('interrupted');
    return {};
  }

  send(message) {
    if (['accept', 'decline'].includes(message.result?.decision)) this.finish('completed');
  }

  finish(status) {
    this.emit('notification', { method: 'turn/completed',
      params: { threadId: 'fixture-thread', turn: { ...this.turn, status } } });
  }

  close() {
    clearTimeout(this.timer);
  }
}
