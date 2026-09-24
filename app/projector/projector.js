(function () {
  const C = window.TCW_CONTENT;
  const params = new URLSearchParams(location.search);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DRAW_MS = 1230;
  const RETRACT_MS = 300;
  const GLOW_BLUR_PX = 10;

  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const lines = document.getElementById('lines');
  const clouds = document.getElementById('clouds');
  if (params.has('debug')) document.body.classList.add('debug');

  let layout = null;
  let selections = { 1: null, 2: null, 3: null };

  function rerouteStartToAnchor(points, anchor, s) {
    if (!anchor || (!anchor.dx && !anchor.dy)) return points;
    const [[x0, y0], [x1, y1], ...rest] = points;
    const sx = x0 + anchor.dx / s, sy = y0 + anchor.dy / s;
    if (x0 === x1) {
      const yj = sy + (y1 - sy) * 0.12;
      return [[sx, sy], [sx, yj], [x0, yj], [x1, y1], ...rest];
    }
    const xj = sx + (x1 - sx) * 0.12;
    return [[sx, sy], [xj, sy], [xj, y0], [x1, y1], ...rest];
  }

  const toD = (points, close) => 'M' + points.map((p) => p.join(' ')).join('L') + (close ? 'Z' : '');

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    parent.appendChild(node);
    return node;
  }

  const places = {};
  for (const l of Object.values(C.landmarks)) {
    if (!l.projection) continue;
    const { place, glow } = l.projection;
    const g = el('g', { class: 'place', 'data-id': l.id, 'data-phase': 'hidden', transform: `translate(${place.x} ${place.y}) scale(${place.s})` }, lines);
    const blur = el('filter', { id: `blur-${l.id}`, x: '-100%', y: '-100%', width: '300%', height: '300%' }, g);
    el('feGaussianBlur', { stdDeviation: GLOW_BLUR_PX / place.s }, blur);
    el('path', { class: 'glow', d: toD(glow, true), filter: `url(#blur-${l.id})` }, g);
    const lead = el('path', { class: 'lead' }, g);
    const follow = el('path', { class: 'follow' }, g);
    places[l.id] = { landmark: l, g, strokes: [lead, follow], timer: null, length: 0 };
  }

  function setPhase(p, phase) {
    p.g.setAttribute('data-phase', phase);
  }

  function shape(p) {
    const { line, place } = p.landmark.projection;
    const d = toD(rerouteStartToAnchor(line, layout && layout.anchors[p.landmark.screen], place.s));
    for (const s of p.strokes) s.setAttribute('d', d);
    p.length = p.strokes[0].getTotalLength() + 20;
    for (const s of p.strokes) s.style.strokeDasharray = `${p.length} ${p.length}`;
  }

  function setOffset(p, offset, animate) {
    for (const s of p.strokes) {
      if (!animate) s.style.transition = 'none';
      s.style.strokeDashoffset = offset;
      if (!animate) { s.getBoundingClientRect(); s.style.transition = ''; }
    }
  }

  function draw(p, delay) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      shape(p);
      setOffset(p, p.length, false);
      setPhase(p, 'drawing');
      setOffset(p, 0, true);
      p.timer = setTimeout(() => setPhase(p, 'drawn'), DRAW_MS);
    }, delay);
  }

  function retract(p) {
    clearTimeout(p.timer);
    if (p.g.getAttribute('data-phase') === 'hidden') return;
    setPhase(p, 'retracting');
    setOffset(p, p.length, true);
    p.timer = setTimeout(() => setPhase(p, 'hidden'), RETRACT_MS);
  }

  function render(next) {
    for (const screen of [1, 2, 3]) {
      const before = selections[screen], after = next[screen];
      if (before === after) continue;
      const wasDrawn = before && places[before];
      if (wasDrawn) retract(places[before]);
      if (after && places[after]) draw(places[after], wasDrawn ? RETRACT_MS : 0);
    }
    selections = { ...next };
  }

  function homography(w, h, q) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
    const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
    return `matrix3d(${m.join(',')})`;
  }

  const stageToWindow = { s: 1, x: 0, y: 0 };
  function fit() {
    stageToWindow.s = Math.min(innerWidth / C.stage.w, innerHeight / C.stage.h);
    stageToWindow.x = (innerWidth - C.stage.w * stageToWindow.s) / 2;
    stageToWindow.y = (innerHeight - C.stage.h * stageToWindow.s) / 2;
    viewport.style.transform = `translate(${stageToWindow.x}px, ${stageToWindow.y}px) scale(${stageToWindow.s})`;
  }

  function applyLayout(next) {
    layout = next;
    stage.style.transform = homography(C.stage.w, C.stage.h, layout.keystone);
    clouds.style.opacity = layout.clouds.opacity;
    clouds.style.mixBlendMode = layout.clouds.blend;
    for (const id in places) {
      const p = places[id];
      if (p.g.getAttribute('data-phase') !== 'hidden') { shape(p); setOffset(p, 0, false); }
    }
  }

  addEventListener('resize', fit);
  fit();

  const hubUrl = params.get('hub') ? `ws://${params.get('hub')}/hub` : `ws://${location.host}/hub`;
  window.projector = {
    places,
    stageToWindow,
    applyLayout,
    get layout() { return layout; },
    get selections() { return selections; },
    hub: window.HubClient({
      url: hubUrl,
      onMessage(msg) {
        if (msg.type === 'state') render(msg.state.selections);
        if (msg.type === 'layout') applyLayout(msg.layout);
      },
      onStatus(up) { document.body.dataset.hub = up ? 'up' : 'down'; },
    }),
  };
})();
