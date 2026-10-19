// Usage: node tools/make-zone-minimaps.mjs   (after node tools/import-assets.mjs; then run the importer again)
// Writes content/minimaps/zone-<screen>.png: one plan with every highlight for that screen's places. WAM's per-place
// minimaps are not registered with each other (522 to 528 px wide), so stacking them doubled every line. This keeps one
// base plan and moves each place's orange highlight onto it by the offset that best overlays its plan lines on the base.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { loadContent } from '../server/content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = loadContent(ROOT);
const OUT = path.join(ROOT, 'content', 'minimaps');
const SEARCH_PX = 12;
const dataUrl = (rel) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'app', rel)).toString('base64')}`;

const base = dataUrl(C.zoneMinimap);
const places = Object.values(C.landmarks).filter((l) => l.minimap).map((l) => ({ id: l.id, screen: l.screen, src: dataUrl(l.minimap) }));

const b = await launch({ port: 9352 });
try {
  const page = await b.open('about:blank', { width: 600, height: 600 });
  const result = await page.eval(`(async () => {
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = new OffscreenCanvas(i.width, i.height); const g = c.getContext('2d'); g.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: g.getImageData(0, 0, i.width, i.height) }; };
    const isOrange = (d, i) => d.data[i + 3] > 40 && d.data[i] - d.data[i + 2] > 60;
    const isLine = (d, i) => d.data[i + 3] > 100 && !isOrange(d, i);
    const baseImg = await load(${JSON.stringify(base)});
    const W = baseImg.w, H = baseImg.h;
    const baseLine = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) baseLine[p] = isLine(baseImg.d, p * 4) ? 1 : 0;
    // The overview carries a stray highlight of its own; clear every orange pixel so the base is plain plan lines.
    const tinted = (d, i) => d.data[i + 3] > 0 && d.data[i] - d.data[i + 2] > 20;
    for (let p = 0; p < W * H; p++) if (tinted(baseImg.d, p * 4)) baseImg.d.data[p * 4 + 3] = 0;

    const offsets = {}, layers = {};
    for (const pl of ${JSON.stringify(places)}) {
      const img = await load(pl.src);
      const lines = [];
      for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) if (isLine(img.d, (y * img.w + x) * 4)) lines.push([x, y]);
      let best = { score: -1 };
      for (let dy = -${SEARCH_PX}; dy <= ${SEARCH_PX}; dy++) for (let dx = -${SEARCH_PX}; dx <= ${SEARCH_PX}; dx++) {
        let score = 0;
        for (const [x, y] of lines) { const bx = x + dx, by = y + dy; if (bx >= 0 && by >= 0 && bx < W && by < H && baseLine[by * W + bx]) score++; }
        if (score > best.score) best = { score, dx, dy };
      }
      offsets[pl.id] = { dx: best.dx, dy: best.dy, overlap: +(best.score / lines.length).toFixed(3) };
      layers[pl.id] = { img, dx: best.dx, dy: best.dy, screen: pl.screen };
    }

    const zones = {};
    for (const screen of [1, 2, 3]) {
      const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
      const out = new ImageData(new Uint8ClampedArray(baseImg.d.data), W, H);
      for (const id in layers) {
        const { img, dx, dy } = layers[id];
        if (layers[id].screen !== screen) continue;
        for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
          const i = (y * img.w + x) * 4;
          if (!isOrange(img.d, i)) continue;
          const bx = x + dx, by = y + dy;
          if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
          const o = (by * W + bx) * 4;
          for (let k = 0; k < 4; k++) out.data[o + k] = img.d.data[i + k];
        }
      }
      g.putImageData(out, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      zones[screen] = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    }
    return { offsets, zones };
  })()`);

  fs.mkdirSync(OUT, { recursive: true });
  for (const [screen, url] of Object.entries(result.zones)) fs.writeFileSync(path.join(OUT, `zone-${screen}.png`), Buffer.from(url.split(',')[1], 'base64'));
  for (const [id, o] of Object.entries(result.offsets)) console.log(`${id.padEnd(11)} offset (${o.dx}, ${o.dy})  line overlap ${(o.overlap * 100).toFixed(1)}%`);
  console.log(`wrote ${OUT}\\zone-{1,2,3}.png`);
} finally {
  await b.close();
}
