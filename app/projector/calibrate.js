(function () {
  const C = window.TCW_CONTENT;
  const P = window.projector;
  const params = new URLSearchParams(location.search);
  const hubHttp = params.get('hub') ? `http://${params.get('hub')}` : '';
  let open = false;
  let draft = null;
  let defaults = null;
  let saved = null;
  let selected = null;
  let panel, handles = [];
  let previewScreen = 1;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function screenStart(screen) {
    const ls = Object.values(C.landmarks).filter((l) => l.screen === screen && l.projection);
    const xs = ls.map((l) => l.projection.place.x + l.projection.line[0][0] * l.projection.place.s);
    const ys = ls.map((l) => l.projection.place.y + l.projection.line[0][1] * l.projection.place.s);
    return [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length];
  }

  const style = document.createElement('style');
  style.textContent = `
    #calib { position: fixed; inset: 0; z-index: 10; cursor: default; font: 16px/1.4 system-ui, sans-serif; color: #fff; }
    #calib .panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,.85); padding: 16px 20px; border: 1px solid #e78530; max-width: 520px; }
    #calib .panel b { color: #ffdfc3; }
    #calib .panel .msg { color: #9f9; min-height: 1.4em; }
    #calib .h { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 2px solid #0ff; border-radius: 50%; background: rgba(0,255,255,.25); cursor: move; }
    #calib .h.anchor { border-color: #e78530; background: rgba(231,133,48,.35); }
    #calib .h.sel { box-shadow: 0 0 0 4px #fff; }
    #calib .h span { position: absolute; left: 32px; top: 2px; white-space: nowrap; font-size: 14px; text-shadow: 0 0 3px #000; }
    body.calibrating { cursor: default; }
    body.calibrating #stage { outline: 2px solid #0ff; }
  `;
  document.head.appendChild(style);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', () => { dragging = null; });

  function build() {
    const root = document.createElement('div');
    root.id = 'calib';
    root.innerHTML = `<div class="panel">
      <b>Calibration</b><br>
      Drag the <b>cyan corners</b> onto the corners of the physical map area.<br>
      Drag the <b>orange dots</b> to where each touch screen meets the map.<br>
      Click a dot, then use arrow keys to nudge (Shift = 10px).<br>
      <b>1 2 3</b> choose a screen, <b>Q W E R</b> preview its lines, <b>0</b> clears.<br>
      <b>C / V</b> cloud opacity down/up (now <span class="cloud"></span>).<br>
      <b>S</b> save · <b>Shift+R</b> reset to WAM defaults · <b>Esc</b> close without saving.
      <div class="msg"></div></div>`;
    document.body.appendChild(root);
    panel = root;
    panel.addEventListener('pointerdown', onDown);
  }

  let dragging = null;

  function stageToScreen([x, y]) {
    const { s, x: ox, y: oy } = P.stageToWindow;
    return [ox + x * s, oy + y * s];
  }

  function screenToStage(x, y) {
    const { s, x: ox, y: oy } = P.stageToWindow;
    return [(x - ox) / s, (y - oy) / s];
  }

  function makeHandles() {
    handles.forEach((h) => h.el.remove());
    handles = [];
    draft.keystone.forEach((_, i) => handles.push({ kind: 'corner', i, label: ['top-left', 'top-right', 'bottom-right', 'bottom-left'][i] }));
    [1, 2, 3].forEach((screen) => handles.push({ kind: 'anchor', screen, label: `screen ${screen}` }));
    for (const h of handles) {
      h.el = document.createElement('div');
      h.el.className = `h ${h.kind}`;
      h.el.innerHTML = `<span>${h.label}</span>`;
      h.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select(h); dragging = { h, x: e.clientX, y: e.clientY }; });
      panel.appendChild(h.el);
    }
    place();
  }

  function anchorStagePos(screen) {
    const [x, y] = screenStart(screen);
    return [x + draft.anchors[screen].dx, y + draft.anchors[screen].dy];
  }

  // Corners live in un-warped stage space; anchors sit inside the keystone-warped stage.
  function handleScreenPos(h) {
    return h.kind === 'corner' ? stageToScreen(draft.keystone[h.i]) : stageToScreen(projectPoint(anchorStagePos(h.screen)));
  }

  function place() {
    for (const h of handles) {
      const [x, y] = handleScreenPos(h);
      h.el.style.left = `${x}px`;
      h.el.style.top = `${y}px`;
    }
    panel.querySelector('.cloud').textContent = draft.clouds.opacity.toFixed(2);
  }

  function projectPoint([x, y]) {
    const stage = document.getElementById('stage');
    const m = new DOMMatrix(getComputedStyle(stage).transform);
    const p = m.transformPoint(new DOMPoint(x, y, 0, 1));
    return [p.x / p.w, p.y / p.w];
  }

  function select(h) {
    selected = h;
    handles.forEach((o) => o.el.classList.toggle('sel', o === h));
  }

  function onDown() { select(null); }

  function onMove(e) {
    if (!dragging) return;
    const [sx, sy] = screenToStage(e.clientX, e.clientY);
    const [px, py] = screenToStage(dragging.x, dragging.y);
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    nudge(dragging.h, sx - px, sy - py);
  }

  function nudge(h, dx, dy) {
    if (h.kind === 'corner') {
      draft.keystone[h.i] = [draft.keystone[h.i][0] + dx, draft.keystone[h.i][1] + dy];
    } else {
      draft.anchors[h.screen].dx += dx;
      draft.anchors[h.screen].dy += dy;
    }
    preview();
  }

  let previewQueued = false;
  function preview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      P.applyLayout(draft);
      place();
    });
  }

  function say(text) { panel.querySelector('.msg').textContent = text; }

  async function save() {
    const res = await fetch(`${hubHttp}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    if (res.ok) saved = clone(draft);
    say(res.ok ? `Saved ${new Date().toLocaleTimeString()}` : `Save failed (${res.status})`);
  }

  function previewLine(slot) {
    const landmark = slot == null ? null : C.screens[previewScreen].landmarks[slot];
    P.hub.send(landmark ? { type: 'select', screen: previewScreen, landmark } : { type: 'clear', screen: previewScreen });
  }

  async function toggle() {
    open = !open;
    document.body.classList.toggle('calibrating', open);
    if (!open) { panel.remove(); panel = null; P.applyLayout(saved); return; }
    const res = await fetch(`${hubHttp}/api/layout`);
    const body = await res.json();
    defaults = body.defaults;
    saved = body.layout;
    draft = clone(saved);
    build();
    makeHandles();
  }

  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') { e.preventDefault(); toggle(); return; }
    if (!open) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && selected) { e.preventDefault(); nudge(selected, ...moves[e.key]); return; }
    if (['1', '2', '3'].includes(e.key)) { previewScreen = +e.key; say(`Previewing screen ${previewScreen}`); }
    const slot = { q: 0, w: 1, e: 2, r: 3 }[e.key.toLowerCase()];
    if (slot !== undefined && !(e.shiftKey && e.key.toLowerCase() === 'r')) previewLine(slot);
    if (e.key === '0') previewLine(null);
    if (e.key.toLowerCase() === 'c' && !e.ctrlKey) { draft.clouds.opacity = Math.max(0, +(draft.clouds.opacity - 0.05).toFixed(2)); preview(); }
    if (e.key.toLowerCase() === 'v') { draft.clouds.opacity = Math.min(1, +(draft.clouds.opacity + 0.05).toFixed(2)); preview(); }
    if (e.key.toLowerCase() === 's') save();
    if (e.shiftKey && e.key.toLowerCase() === 'r') { draft = clone(defaults); preview(); makeHandles(); say('Reset to defaults (not saved yet)'); }
    if (e.key === 'Escape') toggle();
  });

  addEventListener('resize', () => open && place());
  if (params.has('calibrate')) addEventListener('load', () => setTimeout(toggle, 300));
  window.calibration = { toggle, get draft() { return draft; }, save };
})();
