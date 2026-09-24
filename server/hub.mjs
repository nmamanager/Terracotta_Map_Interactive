// Usage: node server/hub.mjs [--port 8080]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { initialState, reduce, SCREEN_IDS } from './state.mjs';
import { loadContent } from './content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const LAYOUT_FILE = process.env.LAYOUT_FILE || path.join(ROOT, 'config', 'layout.json');
const PORT = +(process.argv[process.argv.indexOf('--port') + 1] || process.env.PORT || 8080) || 8080;
const DISCONNECT_GRACE_MS = +process.env.DISCONNECT_GRACE_MS || 5000;

const content = loadContent(ROOT);
const screenByLandmark = Object.fromEntries(Object.values(content.landmarks).map((l) => [l.id, l.screen]));

const DEFAULT_LAYOUT = {
  anchors: { 1: { dx: 0, dy: 0 }, 2: { dx: 0, dy: 0 }, 3: { dx: 0, dy: 0 } },
  keystone: [[0, 0], [content.stage.w, 0], [content.stage.w, content.stage.h], [0, content.stage.h]],
  clouds: { opacity: 0.5, blend: 'normal' },
};

function isLayout(l) {
  const num = (n) => typeof n === 'number' && Number.isFinite(n);
  return l && SCREEN_IDS.every((s) => num(l.anchors?.[s]?.dx) && num(l.anchors?.[s]?.dy))
    && Array.isArray(l.keystone) && l.keystone.length === 4 && l.keystone.every((p) => Array.isArray(p) && p.length === 2 && p.every(num))
    && num(l.clouds?.opacity) && typeof l.clouds?.blend === 'string';
}

function loadLayout() {
  try {
    const l = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
    if (isLayout(l)) return l;
    log(`ignoring invalid ${LAYOUT_FILE}`);
  } catch {}
  return DEFAULT_LAYOUT;
}

function saveLayout(l) {
  fs.mkdirSync(path.dirname(LAYOUT_FILE), { recursive: true });
  fs.writeFileSync(`${LAYOUT_FILE}.tmp`, JSON.stringify(l, null, 2));
  fs.renameSync(`${LAYOUT_FILE}.tmp`, LAYOUT_FILE);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

let state = initialState();
let layout = loadLayout();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function serveFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('not found'); return; }
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? +range[1] : stat.size - +range[2];
      const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://hub');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/api/layout') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Content-Type' }).end(); return; }
    if (req.method === 'PUT') {
      let next;
      try { next = JSON.parse(await readBody(req)); } catch {}
      if (!isLayout(next)) { res.writeHead(400).end('invalid layout'); return; }
      layout = next;
      saveLayout(layout);
      broadcast({ type: 'layout', layout });
      log('layout saved');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ layout, defaults: DEFAULT_LAYOUT }));
    return;
  }
  if (url.pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state)); return; }
  if (url.pathname === '/') { res.writeHead(302, { Location: '/dev/' }).end(); return; }
  const rel = decodeURIComponent(url.pathname).replace(/\/$/, '/index.html');
  const file = path.join(APP, rel);
  if (!file.startsWith(APP + path.sep)) { res.writeHead(403).end(); return; }
  serveFile(req, res, file);
});

const wss = new WebSocketServer({ server, path: '/hub' });
const graceTimers = {};

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

function apply(msg) {
  const next = reduce(state, msg, screenByLandmark);
  if (next === state) return;
  state = next;
  log(`seq ${state.seq}`, JSON.stringify(state.selections));
  broadcast({ type: 'state', state });
}

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.send(JSON.stringify({ type: 'state', state }));
  ws.send(JSON.stringify({ type: 'layout', layout }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type === 'hello' && msg.role === 'touch' && SCREEN_IDS.includes(msg.screen)) {
      ws.screen = msg.screen;
      clearTimeout(graceTimers[msg.screen]);
    }
    apply(msg);
  });
  ws.on('close', () => {
    const screen = ws.screen;
    if (!screen) return;
    log(`screen ${screen} disconnected`);
    clearTimeout(graceTimers[screen]);
    graceTimers[screen] = setTimeout(() => {
      const stillHere = [...wss.clients].some((c) => c.screen === screen && c.readyState === 1);
      if (!stillHere) apply({ type: 'clear', screen });
    }, DISCONNECT_GRACE_MS);
  });
  log(`client connected from ${req.socket.remoteAddress}`);
});

setInterval(() => {
  for (const c of wss.clients) {
    if (!c.alive) { c.terminate(); continue; }
    c.alive = false;
    c.ping();
  }
}, 10000).unref();

server.listen(PORT, '0.0.0.0', () => log(`hub listening on http://0.0.0.0:${PORT} (projector: /projector/, test harness: /dev/)`));
