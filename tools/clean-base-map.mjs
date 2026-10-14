// Usage: node tools/clean-base-map.mjs ["<folder with WAM's files>"]
// Writes content/map/base.png: WAM's projector base map without the workers' graves pit rectangle that WAM painted in
// because the pit was missing from their 3D print. The box is refilled from the lighting around it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? 'C:/Users/Digital PC/Documents/TW Map Interactive files';
const IN = path.join(SRC, 'mausoleum_lit_filledkiosks_darklinesV1.png');
const OUT = path.join(ROOT, 'content', 'map', 'base.png');
// The painted pit (861,265)-(1024,320) plus its drop shadow and bevel.
const PATCH = { x0: 850, y0: 254, x1: 1036, y1: 332 };

const b = await launch({ port: 9351 });
try {
  const page = await b.open('about:blank', { width: 1080, height: 1080 });
  const png = await page.eval(`(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${fs.readFileSync(IN).toString('base64')}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const { x0, y0, x1, y1 } = ${JSON.stringify(PATCH)};
    const d = g.getImageData(0, 0, c.width, c.height);
    const px = (x, y) => { const i = (y * c.width + x) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; };
    const edges = { top: [], bottom: [], left: [], right: [] };
    for (let x = x0; x <= x1; x++) { edges.top[x] = px(x, y0); edges.bottom[x] = px(x, y1); }
    for (let y = y0; y <= y1; y++) { edges.left[y] = px(x0, y); edges.right[y] = px(x1, y); }
    const c00 = px(x0, y0), c10 = px(x1, y0), c01 = px(x0, y1), c11 = px(x1, y1);
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = x0 + 1; x < x1; x++) {
        const u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0);
        const i = (y * c.width + x) * 4;
        for (let k = 0; k < 4; k++) {
          const edgeBlend = (1 - v) * edges.top[x][k] + v * edges.bottom[x][k] + (1 - u) * edges.left[y][k] + u * edges.right[y][k];
          const cornerBlend = (1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k];
          d.data[i + k] = Math.round(edgeBlend - cornerBlend);
        }
      }
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  })()`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${OUT}`);
} finally {
  await b.close();
}
