import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'content', 'size', 'canberra-comparison.png');
const PLAN = path.join(ROOT, 'app', 'assets', 'minimaps', 'pyramid.png');
const FONT = path.join(ROOT, 'app', 'shared', 'fonts', 'source-sans-3.woff2');

const SIZE = 1080;
const ZOOM = 15;
const PARLIAMENT_HOUSE = { lat: -35.30806, lon: 149.12444 };
const PLAN_OUTER_WALL = { x0: 203, y0: 6, x1: 345, y1: 340 };
const OUTER_WALL_NORTH_SOUTH_M = 2165;
const PLAN_METRES_PER_PX = OUTER_WALL_NORTH_SOUTH_M / (PLAN_OUTER_WALL.y1 - PLAN_OUTER_WALL.y0);
const PLAN_LEGEND_MASK = { x: 425, y: 240, w: 97, h: 110 };

const TILE = 256;
const worldPx = (lat, lon) => {
  const n = TILE * 2 ** ZOOM;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};
const mapMetresPerPx = (156543.03392 * Math.cos((PARLIAMENT_HOUSE.lat * Math.PI) / 180)) / 2 ** ZOOM;

async function tile(x, y) {
  const cache = path.join(ROOT, '.cache', 'osm', `${ZOOM}-${x}-${y}.png`);
  if (!fs.existsSync(cache)) {
    const res = await fetch(`https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`, { headers: { 'User-Agent': 'NMA-TCW-map-interactive-build/1.0 (one-off exhibition graphic)' } });
    if (!res.ok) throw new Error(`tile ${x},${y}: ${res.status}`);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
  }
  return `data:image/png;base64,${fs.readFileSync(cache).toString('base64')}`;
}

const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

const b = await launch({ port: 9350 });
try {
  const page = await b.open('about:blank', { width: SIZE, height: SIZE });
  const planScale = PLAN_METRES_PER_PX / mapMetresPerPx;

  const pyramidCentroid = await page.eval(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(dataUrl(PLAN, 'image/png'))}; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] - d[i + 2] > 60) { const p = i / 4; sx += p % img.width; sy += Math.floor(p / img.width); n++; }
    return { x: sx / n, y: sy / n, w: img.width, h: img.height };
  })()`);

  // The plan is south-up; rotating 180° makes it north-up.
  const ph = worldPx(PARLIAMENT_HOUSE.lat, PARLIAMENT_HOUSE.lon);
  const rotatedPyr = { x: (pyramidCentroid.w - pyramidCentroid.x) * planScale, y: (pyramidCentroid.h - pyramidCentroid.y) * planScale };
  const planOrigin = { x: ph.x - rotatedPyr.x, y: ph.y - rotatedPyr.y };
  const origin = { x: Math.round(planOrigin.x + (pyramidCentroid.w * planScale) / 2 - SIZE / 2), y: Math.round(planOrigin.y + (pyramidCentroid.h * planScale) / 2 - SIZE / 2) };

  const tiles = [];
  for (let ty = Math.floor(origin.y / TILE); ty <= Math.floor((origin.y + SIZE) / TILE); ty++) {
    for (let tx = Math.floor(origin.x / TILE); tx <= Math.floor((origin.x + SIZE) / TILE); tx++) {
      tiles.push({ x: tx * TILE - origin.x, y: ty * TILE - origin.y, src: await tile(tx, ty) });
    }
  }

  const wall = PLAN_OUTER_WALL;
  const png = await page.eval(`(async () => {
    const font = new FontFace('Source Sans 3', 'url(${dataUrl(FONT, 'font/woff2')})', { weight: '200 900' });
    document.fonts.add(await font.load());
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
    const c = document.createElement('canvas'); c.width = c.height = ${SIZE};
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(0.85) brightness(1.06)';
    for (const t of ${JSON.stringify(tiles)}) g.drawImage(await load(t.src), t.x, t.y);
    g.filter = 'none';

    const plan = await load(${JSON.stringify(dataUrl(PLAN, 'image/png'))});
    const s = ${planScale}, ox = ${planOrigin.x - origin.x}, oy = ${planOrigin.y - origin.y};
    const tint = new OffscreenCanvas(plan.width, plan.height), tg = tint.getContext('2d');
    tg.drawImage(plan, 0, 0);
    tg.clearRect(${PLAN_LEGEND_MASK.x}, ${PLAN_LEGEND_MASK.y}, ${PLAN_LEGEND_MASK.w}, ${PLAN_LEGEND_MASK.h});
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = '#4a4b2e';
    tg.fillRect(0, 0, plan.width, plan.height);

    g.save();
    g.translate(ox + plan.width * s, oy + plan.height * s);
    g.rotate(Math.PI);
    g.fillStyle = 'rgba(87, 88, 61, 0.28)';
    g.fillRect(${wall.x0} * s, ${wall.y0} * s, ${wall.x1 - wall.x0} * s, ${wall.y1 - wall.y0} * s);
    g.drawImage(tint, 0, 0, plan.width * s, plan.height * s);
    g.restore();

    const kmPx = 1000 / ${mapMetresPerPx};
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(24, ${SIZE} - 96, kmPx + 48, 72);
    g.fillStyle = '#2b2b24';
    g.fillRect(48, ${SIZE} - 50, kmPx, 6);
    g.fillRect(48, ${SIZE} - 60, 3, 16);
    g.fillRect(48 + kmPx - 3, ${SIZE} - 60, 3, 16);
    g.font = '600 20px "Source Sans 3"';
    g.fillText('1 km', 48, ${SIZE} - 66);

    g.save();
    g.translate(${SIZE} - 60, 70);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2b24';
    g.beginPath(); g.moveTo(0, -24); g.lineTo(12, 10); g.lineTo(0, 4); g.lineTo(-12, 10); g.closePath(); g.fill();
    g.font = '700 18px "Source Sans 3"'; g.textAlign = 'center'; g.fillText('N', 0, 28);
    g.restore();
    return c.toDataURL('image/png');
  })()`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${OUT}: plan scale ${planScale.toFixed(4)}, ${mapMetresPerPx.toFixed(3)} m/px, 1 km = ${(1000 / mapMetresPerPx).toFixed(1)} px, ${tiles.length} tiles`);
} finally {
  await b.close();
}
