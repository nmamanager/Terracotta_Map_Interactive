import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, headless = true } = {}) {
  const exe = process.env.BROWSER ?? BROWSERS.find((b) => fs.existsSync(b));
  if (!exe) throw new Error('No Chrome or Edge found; set BROWSER=<path>');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tcw-cdp-'));
  const proc = spawn(exe, [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  const browser = await connect(version.webSocketDebuggerUrl);
  return {
    // Each page gets its own window so every page renders (a background tab in a shared window does not paint or animate).
    async open(url, { width = 1920, height = 1200, touch = false } = {}) {
      const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', newWindow: true, width, height });
      const page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      await page.call('Page.enable');
      await page.call('Runtime.enable');
      await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      if (touch) await page.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
      page.errors = [];
      page.failed = [];
      page.on('Runtime.exceptionThrown', (p) => page.errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
      page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') page.errors.push(p.args.map((a) => a.value ?? a.description).join(' ')); });
      await page.call('Network.enable');
      page.on('Network.responseReceived', (p) => { if (p.response.status >= 400) page.failed.push(`${p.response.status} ${p.response.url}`); });
      page.on('Network.loadingFailed', (p) => { if (!p.canceled) page.failed.push(`${p.errorText} ${p.requestId}`); });
      await page.call('Page.navigate', { url });
      await page.waitFor('document.readyState === "complete"');
      return page;
    },
    async close() {
      proc.kill();
      await sleep(500);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) for (const [name, fn] of listeners) if (name === m.method) fn(m.params);
  };
  const page = {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        const timer = setTimeout(() => { pending.delete(i); reject(new Error(`${method}: no reply after 15s`)); }, 15000);
        pending.set(i, (m) => { clearTimeout(timer); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    on(name, fn) { listeners.push([name, fn]); },
    async eval(expression) {
      const r = await page.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  ${expression}`);
      return r.result.value;
    },
    async waitFor(expression, timeout = 10000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await page.eval(expression)) return; } catch {}
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    // All touch input goes through here: a window that is not in front ignores input.
    async touchEvent(type, touchPoints) {
      await page.call('Page.bringToFront');
      await page.call('Input.dispatchTouchEvent', { type, touchPoints });
    },
    async tap(selector) {
      const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
      if (!box) throw new Error(`nothing visible to tap: ${selector}`);
      await page.touchEvent('touchStart', [{ x: box.x, y: box.y }]);
      await page.touchEvent('touchEnd', []);
    },
    async swipe(fromX, toX, y) {
      await page.touchEvent('touchStart', [{ x: fromX, y }]);
      for (let i = 1; i <= 6; i++) await page.touchEvent('touchMove', [{ x: fromX + ((toX - fromX) * i) / 6, y }]);
      await page.touchEvent('touchEnd', []);
    },
    async screenshot(file) {
      await page.call('Page.bringToFront');
      const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    close() { ws.close(); },
  };
  return page;
}
