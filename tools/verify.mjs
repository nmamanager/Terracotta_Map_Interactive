import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { loadContent } from '../server/content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'artifacts');
const PORT = 8097;
const HUB = `localhost:${PORT}`;
const GRACE_MS = 1500;
const IDLE_S = 4;
const LAYOUT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tcw-verify-')), 'layout.json');
const C = loadContent(ROOT);

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`VERIFIED  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAILED    ${name}\n          ${e.message.split('\n').join('\n          ')}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

let hubProc = null;
async function startHub() {
  hubProc = spawn(process.execPath, [path.join(ROOT, 'server/hub.mjs'), '--port', String(PORT)], {
    env: { ...process.env, LAYOUT_FILE, DISCONNECT_GRACE_MS: String(GRACE_MS) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  hubProc.stdout.on('data', (d) => fs.appendFileSync(path.join(ART, 'hub.log'), d));
  hubProc.stderr.on('data', (d) => fs.appendFileSync(path.join(ART, 'hub.log'), d));
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://${HUB}/api/state`); return; } catch { await sleep(100); }
  }
  throw new Error('hub did not start');
}
async function stopHub() {
  hubProc.kill();
  await new Promise((r) => hubProc.once('exit', r));
}
const hubState = async () => (await (await fetch(`http://${HUB}/api/state`)).json()).selections;

fs.rmSync(ART, { recursive: true, force: true });
fs.mkdirSync(ART, { recursive: true });
await startHub();
const browser = await launch({ port: 9360 });

try {
  const projector = await browser.open(`http://${HUB}/projector/`);
  const touchUrl = (s) => `${pathToFileURL(path.join(ROOT, 'app/touch/index.html')).href}?screen=${s}&hub=${HUB}${s === 1 ? `&idle=${IDLE_S}` : ''}`;
  const touch = {};
  for (const s of [1, 2, 3]) touch[s] = await browser.open(touchUrl(s), { touch: true });
  const drawn = async () => JSON.parse(await projector.eval(`JSON.stringify(Object.keys(projector.places).filter((id) => projector.places[id].g.getAttribute('data-phase') !== 'hidden'))`));
  const waitPhase = async (id, want, timeout = 4000) => {
    const place = `projector.places[${JSON.stringify(id)}]`;
    await projector.waitFor(`${place}.g.getAttribute('data-phase') === ${JSON.stringify(want)}`, timeout);
    if (want === 'drawn') await projector.waitFor(`parseFloat(getComputedStyle(${place}.strokes[0]).strokeDashoffset) < 1 && parseFloat(getComputedStyle(${place}.strokes[1]).strokeDashoffset) < 1`, 2000);
  };
  for (const s of [1, 2, 3]) await touch[s].waitFor(`document.body.dataset.hub === 'up'`);
  await projector.waitFor(`document.body.dataset.hub === 'up'`);

  await check('content: 12 cards across 3 screens, 4 per screen, 11 with projections', async () => {
    for (const s of [1, 2, 3]) {
      const ids = JSON.parse(await touch[s].eval(`JSON.stringify([...document.querySelectorAll('.card')].map((c) => c.dataset.landmark))`));
      expect(JSON.stringify(ids) === JSON.stringify(C.screens[s].landmarks), `screen ${s} cards ${ids}`);
    }
    expect(Object.keys(await projector.eval('projector.places')).length === 11, 'projector places != 11');
  });

  await check('every image, icon and minimap loads from file:// on the touch screens', async () => {
    const urls = Object.values(C.landmarks).flatMap((l) => [l.icon, l.minimap, ...l.images.map((i) => i.src)]).filter(Boolean);
    const bad = JSON.parse(await touch[1].eval(`Promise.all(${JSON.stringify(urls)}.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(null); i.onerror = () => r(u); i.src = '../' + u; }))).then((x) => JSON.stringify(x.filter(Boolean)))`));
    expect(bad.length === 0, `failed: ${bad.join(', ')}`);
  });

  for (const s of [1, 2, 3]) {
    for (const id of C.screens[s].landmarks) {
      const l = C.landmarks[id];
      await check(`screen ${s} → ${id}: detail shows "${l.title}", hub records it, projector ${l.projection ? 'draws line + glow then retracts' : 'draws nothing'}`, async () => {
        await touch[s].tap(`.card[data-landmark="${id}"]`);
        await touch[s].waitFor(`document.body.dataset.view === 'detail' && document.body.dataset.landmark === ${JSON.stringify(id)}`);
        expect((await touch[s].eval(`document.querySelector('#detail .name').textContent`)) === l.title, 'title mismatch');
        expect((await touch[s].eval(`document.querySelector('#detail .body').textContent`)) === l.body, 'body mismatch');
        expect((await hubState())[s] === id, `hub has ${(await hubState())[s]}`);
        if (l.projection) {
          await waitPhase(id, 'drawn');
          const glow = await projector.eval(`+getComputedStyle(projector.places[${JSON.stringify(id)}].g.querySelector('.glow')).opacity`);
          await sleep(900);
          await projector.screenshot(path.join(ART, `projector-${s}-${id}.png`));
          const glowLater = await projector.eval(`+getComputedStyle(projector.places[${JSON.stringify(id)}].g.querySelector('.glow')).opacity`);
          expect(glowLater >= 0.45, `glow opacity ${glow} → ${glowLater}`);
        } else {
          await sleep(1300);
          expect((await drawn()).length === 0, `unexpected lines: ${await drawn()}`);
        }
        await touch[s].screenshot(path.join(ART, `touch-${s}-${id}.png`));
        await touch[s].tap('#detail .back');
        await touch[s].waitFor(`document.body.dataset.view === 'home'`);
        expect((await hubState())[s] === null, 'hub not cleared');
        if (l.projection) await waitPhase(id, 'hidden');
      });
    }
    await touch[s].screenshot(path.join(ART, `touch-${s}-home.png`));
  }

  await check('three screens light three lines at once', async () => {
    await touch[1].tap('.card[data-landmark="pyramid"]');
    await touch[2].tap('.card[data-landmark="army"]');
    await touch[3].tap('.card[data-landmark="chariots"]');
    for (const id of ['pyramid', 'army', 'chariots']) await waitPhase(id, 'drawn');
    expect(JSON.stringify((await drawn()).sort()) === JSON.stringify(['army', 'chariots', 'pyramid']), `drawn: ${await drawn()}`);
    await projector.screenshot(path.join(ART, 'projector-three-at-once.png'));
  });

  await check('reselecting on one screen retracts its old line and draws the new one', async () => {
    await touch[1].tap('#detail .back');
    await touch[1].tap('.card[data-landmark="waterbirds"]');
    await waitPhase('pyramid', 'hidden');
    await waitPhase('waterbirds', 'drawn');
    expect(JSON.stringify((await drawn()).sort()) === JSON.stringify(['army', 'chariots', 'waterbirds']), `drawn: ${await drawn()}`);
  });

  await check('gallery: next, swipe, lightbox with counter, close', async () => {
    await touch[1].tap('#detail .hero .next');
    await touch[1].waitFor(`document.body.dataset.index === '1'`);
    await touch[1].swipe(1400, 900, 800);
    await touch[1].waitFor(`document.body.dataset.index === '2'`);
    await touch[1].tap('#detail .hero img');
    await touch[1].waitFor(`document.body.dataset.view === 'lightbox'`);
    await sleep(500);
    const counter = await touch[1].eval(`document.querySelector('#lightbox .counter').textContent`);
    expect(counter === `3 / ${C.landmarks.waterbirds.images.length}`, `counter "${counter}"`);
    await touch[1].screenshot(path.join(ART, 'touch-1-lightbox.png'));
    await touch[1].tap('#lightbox .close');
    await touch[1].waitFor(`document.body.dataset.view === 'detail'`);
    expect((await hubState())[1] === 'waterbirds', 'selection lost while browsing');
  });

  await check(`idle for ${IDLE_S}s returns screen 1 home and clears its line`, async () => {
    await touch[1].waitFor(`document.body.dataset.view === 'home'`, (IDLE_S + 3) * 1000);
    await waitPhase('waterbirds', 'hidden');
    expect((await hubState())[1] === null, 'hub not cleared');
  });

  await check('install-day layout: saving a screen anchor re-routes that screen\'s lines live and persists', async () => {
    const { layout } = await (await fetch(`http://${HUB}/api/layout`)).json();
    const before = await projector.eval(`projector.places.army.strokes[0].getAttribute('d')`);
    layout.anchors[2] = { dx: 60, dy: 20 };
    const res = await fetch(`http://${HUB}/api/layout`, { method: 'PUT', body: JSON.stringify(layout) });
    expect(res.ok, `PUT ${res.status}`);
    await projector.waitFor(`projector.layout.anchors[2].dx === 60`);
    const after = await projector.eval(`projector.places.army.strokes[0].getAttribute('d')`);
    expect(before !== after, 'army line did not move');
    expect(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')).anchors[2].dx === 60, 'layout file not written');
    await projector.screenshot(path.join(ART, 'projector-anchor-moved.png'));
    const bad = await fetch(`http://${HUB}/api/layout`, { method: 'PUT', body: '{"anchors":1}' });
    expect(bad.status === 400, `invalid layout accepted (${bad.status})`);
  });

  await check('hub restart: projector and touch screens reconnect and the selection comes back', async () => {
    await stopHub();
    await startHub();
    await touch[2].waitFor(`document.body.dataset.hub === 'up'`, 8000);
    await projector.waitFor(`document.body.dataset.hub === 'up'`, 8000);
    await projector.waitFor(`projector.selections[2] === 'army'`, 8000);
    await waitPhase('army', 'drawn');
    expect((await hubState())[2] === 'army', `hub has ${(await hubState())[2]}`);
    expect(await projector.eval(`projector.layout.anchors[2].dx === 60`), 'layout not reloaded from disk');
  });

  await check(`a touch PC that disappears has its line cleared after the ${GRACE_MS}ms grace`, async () => {
    await touch[3].call('Page.navigate', { url: 'about:blank' });
    await sleep(GRACE_MS / 2);
    expect((await hubState())[3] === 'chariots', 'cleared before grace period');
    await waitPhase('chariots', 'hidden', GRACE_MS + 3000);
  });

  await check('kiosk guard: context menu and two-finger touch are blocked', async () => {
    const prevented = await touch[1].eval(`(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })()`);
    expect(prevented, 'contextmenu not prevented');
    await touch[1].touchEvent('touchStart', [{ x: 500, y: 500, id: 1 }, { x: 700, y: 600, id: 2 }]);
    await touch[1].touchEvent('touchEnd', []);
    expect((await touch[1].eval(`document.body.dataset.view`)) === 'home', 'two-finger touch changed the view');
  });

  await check('staff menu: five taps top-left, wrong PIN ignored, right PIN offers screen switch', async () => {
    for (let i = 0; i < 5; i++) await touch[1].tap('#staff-corner');
    await touch[1].waitFor(`!document.getElementById('staff').hidden`);
    for (const d of '1111') await touch[1].tap(`#staff .pin button:nth-child(${d === '0' ? 10 : +d})`);
    expect((await touch[1].eval(`document.querySelectorAll('#staff .screens button').length`)) === 0, 'wrong PIN accepted');
    for (const d of '2468') await touch[1].tap(`#staff .pin button:nth-child(${+d})`);
    expect((await touch[1].eval(`document.querySelectorAll('#staff .screens button').length`)) === 4, 'screen switch not offered');
    await touch[1].screenshot(path.join(ART, 'touch-1-staff.png'));
    await touch[1].tap('#staff .dismiss');
  });

  await check('single-screen test mode: ?preview shows the live projector in a corner', async () => {
    const solo = await browser.open(`${touchUrl(2)}&preview`, { touch: true });
    await solo.waitFor(`document.body.dataset.hub === 'up' && !!document.getElementById('preview')`);
    await sleep(1500);
    await solo.tap('.card[data-landmark="horses"]');
    await waitPhase('horses', 'drawn');
    await sleep(1500);
    await solo.screenshot(path.join(ART, 'touch-2-preview.png'));
    expect((await solo.eval(`document.getElementById('preview').src`)) === `http://${HUB}/projector/?preview`, 'preview src');
    await solo.tap('#detail .back');
    await waitPhase('horses', 'hidden');
  });

  await check('calibration: panel shows 4 corner and 3 screen handles, a drag moves a corner, reopening adds no duplicate styles', async () => {
    const cal = await browser.open(`http://${HUB}/projector/?calibrate`);
    await cal.waitFor(`document.querySelectorAll('#calib .h.corner').length === 4 && document.querySelectorAll('#calib .h.anchor').length === 3`);
    const box = await cal.eval(`(() => { const r = document.querySelector('#calib .h.corner').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cal.call('Page.bringToFront');
    await cal.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cal.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 40, y: box.y + 30, button: 'left' });
    await cal.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 40, y: box.y + 30, button: 'left' });
    await cal.waitFor(`calibration.draft.keystone[0][0] > 440`);
    await cal.screenshot(path.join(ART, 'projector-calibration.png'));
    const styles = await cal.eval(`document.head.querySelectorAll('style').length`);
    await cal.eval(`calibration.toggle()`);
    await cal.eval(`calibration.toggle()`);
    await cal.waitFor(`document.querySelectorAll('#calib .h').length === 7`);
    expect((await cal.eval(`document.head.querySelectorAll('style').length`)) === styles, 'style tags accumulate on reopen');
    cal.close();
  });

  for (const [width, height] of [[1920, 1080], [1920, 1200]]) {
    await check(`${width}x${height}: projector map square is as large as fits, centred; every touch page fits with nothing clipped`, async () => {
      const proj = await browser.open(`http://${HUB}/projector/`, { width, height });
      const map = JSON.parse(await proj.eval(`JSON.stringify(document.getElementById('map').getBoundingClientRect())`));
      const size = Math.min(height, (C.map.size * width) / C.stage.w);
      expect(Math.abs(map.height - size) < 1 && Math.abs(map.top - (height - size) / 2) < 1 && Math.abs(map.left + map.width / 2 - width / 2) < 1, `map box ${JSON.stringify(map)}, wanted ${size}px centred`);
      proj.close();
      const page = await browser.open(touchUrl(1), { width, height, touch: true });
      const clipped = `JSON.stringify([...document.querySelectorAll('.view.active *')].filter((e) => { const r = e.getBoundingClientRect(); return r.height && (r.bottom > innerHeight + 1 || r.top < -1 || r.right > innerWidth + 1); }).map((e) => e.className || e.tagName))`;
      const problems = [];
      for (const s of [1, 2, 3]) {
        await page.call('Page.navigate', { url: touchUrl(s) });
        await page.waitFor(`document.readyState === 'complete' && document.querySelectorAll('.card').length === 4`);
        await sleep(400);
        const home = JSON.parse(await page.eval(clipped));
        if (home.length) problems.push(`screen ${s} home: ${home}`);
        for (const id of C.screens[s].landmarks) {
          await page.eval(`touch.set({ view: 'detail', landmark: ${JSON.stringify(id)}, index: 0 })`);
          await sleep(500);
          const bad = JSON.parse(await page.eval(clipped));
          if (bad.length) problems.push(`${id}: ${bad}`);
        }
        await page.eval(`touch.set({ view: 'home', landmark: null, index: 0 })`);
      }
      await page.eval(`touch.set({ view: 'detail', landmark: 'waterbirds', index: 0 })`);
      await sleep(500);
      await page.screenshot(path.join(ART, `touch-${width}x${height}-waterbirds.png`));
      page.close();
      expect(problems.length === 0, problems.join('\n'));
    });
  }

  await check('no script errors or failed requests on any page', async () => {
    const pages = { projector, touch1: touch[1], touch2: touch[2] };
    const problems = Object.entries(pages).flatMap(([n, p]) => [...p.errors, ...p.failed.filter((f) => !f.includes('ERR_CONNECTION_REFUSED') && !f.includes('net::ERR_ABORTED'))].map((e) => `${n}: ${e}`));
    expect(problems.length === 0, problems.join('\n'));
  });
} finally {
  await browser.close();
  await stopHub();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks VERIFIED. Screenshots in artifacts/');
process.exit(failures ? 1 : 0);
