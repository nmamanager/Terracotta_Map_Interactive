// Usage: node tools/import-assets.mjs "<source dir>" [--check]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'C:/Users/Digital PC/Documents/TW Map Interactive files';
const CHECK_ONLY = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'app', 'assets');
const CONTENT_JS = path.join(ROOT, 'app', 'shared', 'content.js');

const STAGE = { w: 1920, h: 1200 };
const MAP_V_MARGIN = 60;
const MAP = { x: (STAGE.w - 1080) / 2, y: MAP_V_MARGIN, size: 1080 };

const SCREENS = {
  1: { zone: 'Explore the Northern Zone', landmarks: ['pyramid', 'waterbirds', 'concubines', 'size'], flipMinimap: false },
  2: { zone: 'Explore the Eastern Zone', landmarks: ['army', 'acrobats', 'armour', 'horses'], flipMinimap: true },
  3: { zone: 'Explore the Western Zone', landmarks: ['craftsmen', 'chariots', 'officials', 'animals'], flipMinimap: true },
};

const PLACE_IDS = {
  pyramid: 56933, craftsmen: 56934, concubines: 56936, chariots: 56937, officials: 56938, animals: 56939,
  waterbirds: 56940, army: 56941, acrobats: 56942, armour: 56943, horses: 56944,
};

const ONEDRIVE_FOLDERS = {
  pyramid: 'Great Pyramid', waterbirds: 'Pit of Bronze Birds', concubines: 'Tombs of the Concubines',
  chariots: 'Bronze Chariots Pit', officials: 'Pit of Civil Officials', animals: 'First Emperors Zoo',
  craftsmen: 'Workers graves', army: 'Terracotta Army Pits', acrobats: 'Pit of Acrobats',
  armour: 'Pit of Stone Armour', horses: 'Horse Stable Pits',
};

// MausoleumMap.stl, which NMA prints, has the workers' graves pit 8.5 map px further south than WAM drew its outline
// (WAM's own print lacked the pit). Measured with Blender ray casts; the projector frame is the model rotated 180°.
const ALIGN_TO_STL = { craftsmen: { dx: 0, dy: -8.5 } };

const SIZE_CARD = {
  title: 'Size of the Mausoleum',
  body: 'Visual comparison between the size of the Qin Mausoleum complex and central Canberra, with Qin Shihuang’s pyramid placed over Parliament House.',
  image: { file: 'size/canberra-comparison.png', caption: 'Canberra map data © OpenStreetMap contributors (openstreetmap.org/copyright)' },
};

// Python's zipfile, because Windows tar drops the entry whose name is UTF-8 without the zip UTF-8 flag (秦陵).
const UNZIP_PY = `
import sys, zipfile, os
z = zipfile.ZipFile(sys.argv[1])
for info in z.infolist():
    name = info.filename if info.flag_bits & 0x800 else info.filename.encode('cp437').decode('utf-8')
    target = os.path.join(sys.argv[2], name)
    if name.endswith('/'): continue
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f: f.write(z.read(info))
`;

function unzip(zip, dest) {
  execFileSync('python', ['-c', UNZIP_PY, zip, dest]);
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const text = (html) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseEntities(html) {
  const blocks = html.split('<div class="page-entity" id="entity-').slice(1);
  const out = {};
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf('"'));
    const title = text(block.match(/(?:id|class)="entity-name"[^>]*>([\s\S]*?)<\/h1>/)[1]);
    const body = text(block.match(/(?:id|class)="entity-about-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/)[1]);
    const slides = [...block.matchAll(/<div class="(landscape|portrait)[^"]*"[\s\S]*?<a href="\.\/museum\.wa\.gov\.au_files\/([^"]+)"[\s\S]*?class="lightbox-credit">([^<]*)</g)]
      .map(([, orientation, file, credit]) => ({ file: decodeURIComponent(file), portrait: orientation === 'portrait', credit: decodeURIComponent(credit).trim() || undefined }));
    out[id] = { title, body, slides };
  }
  return out;
}

function parseWarning(html) {
  const m = html.match(/#entity-craftsmen"[\s\S]*?class="item-content-warning">([^<]+)</);
  return m[1].trim();
}

function pathPoints(d) {
  const tokens = d.match(/[MLHVZ]|-?\d*\.?\d+/gi);
  assert.ok(tokens.join('').length > 0);
  const pts = [];
  let cmd = null, x = 0, y = 0;
  for (let i = 0; i < tokens.length;) {
    if (/[A-Z]/i.test(tokens[i])) {
      cmd = tokens[i++];
      assert.match(cmd, /^[MLHVZ]$/, `unsupported path command ${cmd} in ${d}`);
      if (cmd === 'Z') { pts.push({ ...pts[0] }); continue; }
    }
    if (cmd === 'M' || cmd === 'L') { x = +tokens[i++]; y = +tokens[i++]; }
    else if (cmd === 'H') x = +tokens[i++];
    else if (cmd === 'V') y = +tokens[i++];
    pts.push({ x, y });
  }
  return pts;
}

function readSvg(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
  const shape = svg.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
  const rect = svg.match(/<rect[^>]*>/)?.[0];
  if (shape) return { w, h, points: pathPoints(shape) };
  const attr = (n) => +rect.match(new RegExp(`\\s${n}="([\\d.]+)"`))[1];
  const [rx, ry, rw, rh] = ['x', 'y', 'width', 'height'].map(attr);
  return { w, h, points: [{ x: rx, y: ry }, { x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }, { x: rx, y: ry }] };
}

function distToSegment(p, a, b) {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}

// The glow outline is a hand-redrawn copy of the connector's tail.
function glowOffset(connector, glow) {
  const xs = glow.map((g) => g.x), ys = glow.map((g) => g.y);
  const corners = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.min(...xs), Math.max(...ys)], [Math.max(...xs), Math.max(...ys)]];
  let best = { error: Infinity };
  for (const c of connector) {
    for (const [gx, gy] of corners) {
      const dx = c.x - gx, dy = c.y - gy;
      const error = glow.reduce((sum, g) => sum + Math.min(...connector.slice(1).map((b, i) => distToSegment({ x: g.x + dx, y: g.y + dy }, connector[i], b))), 0) / glow.length;
      if (error < best.error) best = { error, dx, dy };
    }
  }
  return best;
}

function parseConnectorCss(css) {
  const px = (v) => {
    if (v == null) return undefined;
    const calc = v.match(/calc\(var\(--map-v-margin\)\s*\+\s*(-?[\d.]+)px\)/);
    return calc ? MAP_V_MARGIN + +calc[1] : parseFloat(v);
  };
  const out = {};
  for (const [, id, body] of css.matchAll(/#map-place-(\w+) \.connector \{([^}]*)\}/g)) {
    const prop = (n) => body.match(new RegExp(`(?:^|[\\s;])${n}:\\s*([^;]+);`))?.[1].trim();
    out[id] = Object.fromEntries(['width', 'height', 'top', 'bottom', 'left', 'right'].map((n) => [n, px(prop(n))]));
  }
  return out;
}

// Reproduces how the browser placed each connector <svg> (preserveAspectRatio xMidYMid meet) on WAM's 1920x1200 map page.
function placeConnector(box, svg) {
  const w = box.width;
  const s = box.height ? Math.min(w / svg.w, box.height / svg.h) : w / svg.w;
  const h = box.height ?? svg.h * s;
  const x = box.left ?? STAGE.w - box.right - w;
  const y = box.top ?? STAGE.h - box.bottom - h;
  return { x: x + (w - svg.w * s) / 2, y: y + (h - svg.h * s) / 2, s };
}

const alignToStl = (id, place) => ({ ...place, x: place.x + (ALIGN_TO_STL[id]?.dx ?? 0), y: place.y + (ALIGN_TO_STL[id]?.dy ?? 0) });

const round = (n) => Math.round(n * 100) / 100;

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function build() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcw-import-'));
  unzip(path.join(SRC, 'Website.zip'), tmp);
  unzip(path.join(SRC, 'OneDrive_2026-09-23.zip'), tmp);
  const web = path.join(tmp, 'Website', 'museum.wa.gov.au_files');
  const html = fs.readFileSync(path.join(tmp, 'Website', 'museum.wa.gov.au.html'), 'utf8');
  const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');
  const entities = parseEntities(html);
  const boxes = parseConnectorCss(css);
  const warning = parseWarning(html);

  if (!CHECK_ONLY) fs.rmSync(ASSETS, { recursive: true, force: true });
  const put = (from, rel) => { if (!CHECK_ONLY) copy(from, path.join(ASSETS, rel)); return `assets/${rel}`; };

  const landmarks = {};
  for (const [screen, { landmarks: ids }] of Object.entries(SCREENS)) {
    for (const id of ids) {
      if (id === 'size') {
        landmarks.size = {
          id, screen: +screen, title: SIZE_CARD.title, body: SIZE_CARD.body,
          icon: put(path.join(web, 'map_icon.png'), 'icons/size.png'),
          minimap: null,
          images: [{ src: put(path.join(ROOT, 'content', SIZE_CARD.image.file), SIZE_CARD.image.file), thumb: `assets/${SIZE_CARD.image.file}`, portrait: false, caption: SIZE_CARD.image.caption }],
          projection: null,
        };
        continue;
      }
      const e = entities[id];
      const pid = PLACE_IDS[id];
      const images = e.slides.map((slide, i) => {
        const ext = path.extname(slide.file).toLowerCase().replace('.jpeg', '.jpg');
        const n = String(i + 1).padStart(2, '0');
        const src = put(path.join(web, slide.file), `landmarks/${id}/${n}${ext}`);
        return { src, thumb: src, portrait: slide.portrait, ...(slide.credit && { credit: slide.credit }) };
      });
      const connectorSvg = readSvg(path.join(SRC, 'svgs', 'mainmap', `${pid}-${id}-connector.svg`));
      const glowSvg = readSvg(path.join(SRC, 'svgs', 'mainmap', `${pid}-${id}-glow.svg`));
      const off = glowOffset(connectorSvg.points, glowSvg.points);
      assert.ok(off.error < 6, `${id}: glow outline does not match connector tail (mean error ${off.error})`);
      console.log(`${id.padEnd(11)} glow fit error ${off.error.toFixed(2)} at (${off.dx}, ${off.dy})`);
      landmarks[id] = {
        id, screen: +screen, title: e.title, body: e.body,
        ...(id === 'craftsmen' && { warning }),
        icon: put(path.join(web, `${pid}-${id}.png`), `icons/${id}.png`),
        minimap: put(path.join(web, `minimap_${id}.png`), `minimaps/${id}.png`),
        images,
        projection: {
          place: Object.fromEntries(Object.entries(alignToStl(id, placeConnector(boxes[id], connectorSvg))).map(([k, v]) => [k, round(v)])),
          line: connectorSvg.points.map((p) => [p.x, p.y]),
          glow: glowSvg.points.map((p) => [round(p.x + off.dx), round(p.y + off.dy)]),
        },
      };
    }
  }

  const zoneMinimap = put(path.join(web, 'minimap_map.png'), 'minimaps/overview.png');
  const cleanBase = path.join(ROOT, 'content', 'map', 'base.png');
  put(fs.existsSync(cleanBase) ? cleanBase : path.join(SRC, 'mausoleum_lit_filledkiosks_darklinesV1.png'), 'map/base.png');
  put(path.join(SRC, 'mausoleum_cloudshadow_5mloop_slowfade.webm'), 'map/clouds.webm');

  const content = {
    stage: STAGE, map: MAP,
    title: 'The Qin Mausoleum',
    zoneMinimap,
    screens: Object.fromEntries(Object.entries(SCREENS).map(([n, s]) => {
      const zone = path.join(ROOT, 'content', 'minimaps', `zone-${n}.png`);
      return [n, { ...s, minimap: fs.existsSync(zone) ? put(zone, `minimaps/zone-${n}.png`) : zoneMinimap }];
    })),
    landmarks,
  };

  verify(content, tmp);
  const js = `// Generated by tools/import-assets.mjs. Edit the source files and rerun rather than editing this file.\nwindow.TCW_CONTENT = ${JSON.stringify(content, null, 2)};\n`;
  if (!CHECK_ONLY) fs.writeFileSync(CONTENT_JS, js);
  else assert.equal(fs.readFileSync(CONTENT_JS, 'utf8').replace(/\r\n/g, '\n'), js, 'content.js is stale: rerun without --check');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${CHECK_ONLY ? 'checked' : 'wrote'} ${Object.keys(landmarks).length} landmarks, ${Object.values(landmarks).reduce((n, l) => n + l.images.length, 0)} images`);
}

function verify(content, tmp) {
  const ls = Object.values(content.landmarks);
  assert.equal(ls.length, 12);
  assert.deepEqual(ls.filter((l) => !l.projection).map((l) => l.id), ['size']);
  for (const l of ls) {
    for (const f of [l.icon, l.minimap, ...l.images.map((i) => i.src)].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'app', f)) || CHECK_ONLY, `missing ${f}`);
    }
    const folder = ONEDRIVE_FOLDERS[l.id];
    if (!folder) continue;
    const [title, , ...body] = fs.readFileSync(path.join(tmp, 'Extracted photos and text', folder, 'Text.txt'), 'utf8').split(/\r?\n/);
    assert.equal(l.title, title.trim(), `${l.id} title differs from OneDrive`);
    assert.equal(l.body, body.join(' ').replace(/\s+/g, ' ').trim(), `${l.id} body differs from OneDrive`);
  }
}

build();
