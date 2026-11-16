const messages = {
  notifyCompleted: 'Codex 任务已完成。',
  notifyApproval: '有请求等待审批。请打开 HaloFlux 查看。',
  notifyFailed: 'Codex 任务执行失败。',
  notifyConnection: 'Codex 或本地桥接连接异常。请打开 HaloFlux 检查。',
};
const cooldown = { notifyCompleted: 4000, notifyApproval: 3000, notifyFailed: 4000, notifyConnection: 15000 };

export function desktopNotifications(preferences, isViewingLive, display, clock = () => performance.now()) {
  const seen = new Set();
  const lastShown = new Map();
  let previous;
  let lost = false;
  function send(category, key) {
    if (key && seen.has(key)) return;
    if (key) {
      if (seen.size >= 256) seen.delete(seen.values().next().value);
      seen.add(key);
    }
    if (!preferences.notifications || !preferences[category] || isViewingLive()) return;
    const now = clock();
    if (now - (lastShown.get(category) ?? -Infinity) < cooldown[category]) return;
    lastShown.set(category, now);
    display(messages[category]);
  }
  function disconnected() {
    if (!lost) send('notifyConnection');
    lost = true;
  }
  return {
    observe(live, notices) {
      if (live.connection === 'connected') lost = false;
      if (previous && ['connected', 'connecting'].includes(previous.connection) && live.connection === 'disconnected') {
        disconnected();
      }
      for (const key of notices.approvals) send('notifyApproval', 'approval/' + key);
      if (notices.turn && live.outcome === 'completed') send('notifyCompleted', 'terminal/' + notices.turn);
      if (notices.turn && live.outcome === 'failed') send('notifyFailed', 'terminal/' + notices.turn);
      previous = live;
    },
    disconnected,
  };
}
