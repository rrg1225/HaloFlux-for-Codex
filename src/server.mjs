import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexSession, ActionError } from './session.mjs';
import { Demo } from './demo.mjs';
import { codexBinary } from './codex-rpc.mjs';
import { createHealthCheck, FAILURE, FAILURE_HINTS } from './diagnostics.mjs';
import pkg from '../package.json' with { type: 'json' };

const LOOPBACK = '127.0.0.1';
const ROOT = new URL('../', import.meta.url);
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mp3: 'audio/mpeg', jpg: 'image/jpeg', json: 'application/json',
  md: 'text/plain; charset=utf-8' };
const STATIC = {
  '/': 'public/index.html', '/app.css': 'public/app.css', '/app.js': 'public/app.js',
  '/approval-ui.js': 'public/approval-ui.js',
  '/renderer.css': 'public/renderer.css', '/renderer.js': 'public/renderer.js',
  '/original': 'index.html', '/lab.html': 'lab.html', '/mobile.html': 'mobile.html',
  '/canvas-desktop': 'lab.html', '/canvas-mobile': 'mobile.html',
  '/audio/sw421k.mp3': 'audio/sw421k.mp3',
  '/wallpaper/': 'wallpaper/index.html', '/wallpaper/wp.js': 'wallpaper/wp.js',
  '/wallpaper/project.json': 'wallpaper/project.json', '/wallpaper/preview.jpg': 'wallpaper/preview.jpg',
  '/wallpaper/audio/sw421k.mp3': 'wallpaper/audio/sw421k.mp3',
  '/LICENSE': 'LICENSE', '/NOTICE.md': 'NOTICE.md',
};

function localHtml(html, embed) {
  const offline = html.replace(/^<link[^\n]*fonts\.googleapis\.com[^\n]*>\r?\n/gm, '');
  if (!embed) return offline;
  // The source files stay byte-for-byte intact. The hosted embed adds its own UI boundary.
  return offline
    .replace('</head>', '<link rel="stylesheet" href="/renderer.css"></head>')
    .replace('<body>', '<body class="codex-embed">')
    .replace("stage.getContext('2d'); const S_MAIN", "stage.getContext('2d', { alpha: false }); const S_MAIN")
    .replace(/^(  stage\.width = .*;)$/m, '  DPR = window.haloFluxDpr?.(DPR) ?? DPR;\n$1')
    .replace('ROT = r.height > r.width * 1.05;', 'ROT = window.haloFluxCrop?.() !== false && r.height > r.width * 1.05;')
    .replace('  buildWeb(); buildLanes(); buildCards(); buildOuter();', '  window.haloFluxCompose?.();\n  buildWeb(); buildLanes(); buildCards(); buildOuter();')
    .replace(/requestAnimationFrame\(frame\)/g, '(window.haloFluxScheduleFrame?.() ?? requestAnimationFrame(frame))')
    .replace(/\/\* ---------- callout box[\s\S]*?(?=\/\* ={10,}\s*LOOP)/, panels =>
      'const skipDecorativeTimer = () => {};\n' + panels.replace(/\bsetInterval\(/g, 'skipDecorativeTimer('))
    .replace('function drawOuterNear() {', 'const nearStrokes = { dash: [], tip: [] };\nfunction drawOuterNear() {')
    .replace('  const col = { dash: [], tip: [] };', '  const col = nearStrokes;\n  col.dash.length = col.tip.length = 0;')
    .replace(/    tx\.strokeStyle = r\.b \? (`[^\r\n]+`) : (`[^\r\n]+`);/, '    tx.strokeStyle = r.b ? runnerTint : runnerWhite;')
    .replace(/^(  for \(let i = 0; i < runners\.length; i\+\+\) \{)/m,
      '  const runnerTint = `rgba(240,166,198,${Math.min(1, 0.9 * C.runnerBright)})`;\n' +
      '  const runnerWhite = `rgba(250,251,255,${Math.min(1, 0.75 * C.runnerBright)})`;\n$1')
    .replace("const KEY = 'paperlab.bgm.v1';", "const KEY = 'haloflux.codex.bgm.v1';")
    .replace('let st = { on: true, vol: 60 };', 'let st = { on: false, vol: 60 };')
    .replace('</body>', '<script src="/renderer.js"></script></body>');
}

async function loadAssets(token) {
  const entries = await Promise.all(Object.entries(STATIC).map(async ([route, file]) => {
    const type = TYPES[file.split('.').at(-1)] || TYPES.md;
    let data = await readFile(new URL(file, ROOT));
    if (route === '/') data = data.toString().replace('__BRIDGE_TOKEN__', token).replace('__VERSION__', pkg.version);
    else if (type === TYPES.html) data = localHtml(data.toString(), route.startsWith('/canvas-'));
    const hashes = type === TYPES.html ? [...data.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) =>
      " 'sha256-" + createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64') + "'").join('') : '';
    return [route, { type, data, hashes }];
  }));
  return new Map(entries);
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': TYPES.json });
  response.end(JSON.stringify(payload));
}

async function readAction(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new ActionError('请求过大。');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new ActionError('无效请求。'); }
  if (!body || typeof body.action !== 'string') throw new ActionError('无效操作。');
  return body;
}

export async function startBridge({ cwd = process.cwd(), port = 4637, makeRpc, clock, resolveCodex = codexBinary } = {}) {
  const token = randomBytes(32).toString('hex');
  const assets = await loadAssets(token);
  const streams = new Set();
  let revision = 0;
  let broadcast;
  const envelope = () => ({ revision, live: live.snapshot, demo: demo.snapshot });
  const publish = () => {
    revision++;
    if (broadcast) return;
    // A burst of JSONL notifications can describe one visible state. The private
    // timeline still records each event, while SSE sends only the latest snapshot.
    broadcast = setImmediate(() => {
      broadcast = null;
      const data = 'data: ' + JSON.stringify(envelope()) + '\n\n';
      for (const stream of streams) {
        if (stream.writableLength > 64 * 1024) stream.destroy();
        else stream.write(data);
      }
    });
  };
  const live = new CodexSession({ cwd, publish: () => { if (streams.size) publish(); }, makeRpc, clock });
  const healthCheck = createHealthCheck(resolveCodex, live);
  const demo = new Demo(() => { if (streams.size) publish(); });
  let origin;
  let activeActions = 0;
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, connectionsCheckingInterval: 5000 },
    async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin)) {
      json(response, 403, { error: '来源不受信任。' });
      return;
    }
    const path = request.url?.split('?')[0];
    const asset = assets.get(path);
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'" +
      (asset?.hashes ?? '') + "; style-src 'self'" + (asset?.hashes ? " 'unsafe-inline'" : '') +
      "; img-src 'self' data:; media-src 'self' blob:; frame-ancestors " +
      (path === '/' ? "'none'" : "'self'") + "; object-src 'none'; base-uri 'none'; form-action 'self'");
    if (path === '/favicon.ico' && request.method === 'GET') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && path === '/api/events') {
      if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
        json(response, 403, { error: '来源不受信任。' });
        return;
      }
      if (streams.size >= 12) {
        json(response, 429, { error: '连接数已满。' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('retry: 1500\ndata: ' + JSON.stringify(envelope()) + '\n\n');
      streams.add(response);
      response.on('close', () => streams.delete(response));
      return;
    }
    if (request.method === 'POST' && path === '/api/action') {
      const supplied = request.headers['x-haloflux-token'];
      if (request.headers.origin !== origin || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(token, 'hex')) ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') ||
        request.headers['content-type'] !== 'application/json') {
        json(response, 403, { error: '操作未授权。' });
        return;
      }
      if (activeActions >= 24) {
        json(response, 429, { error: '操作过多，请稍后重试。' });
        return;
      }
      activeActions++;
      try {
        const body = await readAction(request);
        if (body.action === 'health') {
          json(response, 200, await healthCheck());
        } else if (body.action === 'demo') {
          if (!['success', 'approval', 'failure'].includes(body.scenario)) throw new ActionError('未知演示场景。');
          if (!demo.run(body.scenario)) throw new ActionError('请等待当前演示结束。');
          json(response, 200, {});
        } else if (body.action === 'demo-context') {
          json(response, 200, { ticket: demo.adapter.approvals.get(1)?.token ?? null });
        } else if (body.action === 'demo-details') {
          json(response, 200, { task: demo.adapter.taskDetail() });
        } else if (body.action === 'demo-decision') {
          if (!demo.decide(body.ticket, body.decision)) throw new ActionError('该请求已失效。');
          json(response, 200, {});
        } else if (body.action === 'demo-decline') {
          if (!demo.decline(body.token)) throw new ActionError('该请求已失效。');
          json(response, 200, {});
        } else if (body.action === 'demo-interrupt') {
          if (!demo.snapshot.active) throw new ActionError('当前没有可中断的演示。');
          demo.finish('interrupted');
          json(response, 200, {});
        } else {
          json(response, 200, await live.action(body));
        }
      } catch (error) {
        const category = Object.hasOwn(FAILURE_HINTS, error.category) ? error.category : FAILURE.application;
        if (!(error instanceof ActionError)) live.noteFailure(category);
        json(response, error instanceof ActionError ? 400 : 500,
          { error: error instanceof ActionError ? error.message : FAILURE_HINTS[category] });
      } finally {
        activeActions--;
      }
      return;
    }
    if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': Buffer.byteLength(asset.data) });
      response.end(request.method === 'HEAD' ? undefined : asset.data);
    } else {
      json(response, 404, { error: '未找到资源。' });
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => {
      origin = 'http://' + LOOPBACK + ':' + server.address().port;
      server.off('error', reject);
      accept();
    });
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      if (stream.writableLength > 64 * 1024) stream.destroy();
      else stream.write(': heartbeat\n\n');
    }
  }, 15000).unref();
  const disconnectStreams = () => { for (const stream of streams) stream.end(); };
  return {
    origin,
    get streamCount() { return streams.size; },
    disconnectStreams,
    close() {
      live.stop();
      demo.stop();
      clearInterval(heartbeat);
      clearImmediate(broadcast);
      disconnectStreams();
      server.close();
      server.closeAllConnections();
    },
  };
}

export async function startLocal(workspace = process.cwd()) {
  const cwd = await realpath(workspace);
  if (!(await stat(cwd)).isDirectory()) throw new Error('Invalid workspace directory.');
  const port = Number(process.env.HALOFLUX_PORT ?? 4637);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  const bridge = await startBridge({ cwd, port });
  console.log('HaloFlux for Codex  ' + bridge.origin);
  process.once('SIGINT', () => bridge.close());
  process.once('SIGTERM', () => bridge.close());
  return bridge;
}

export function startupError(error) {
  return error.code === 'EADDRINUSE'
    ? 'HaloFlux port is in use. Set HALOFLUX_PORT to a different port.'
    : 'HaloFlux could not start. Check the workspace directory, port, and project files.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await startLocal(process.argv[2]);
  } catch (error) {
    console.error(startupError(error));
    process.exitCode = 1;
  }
}
