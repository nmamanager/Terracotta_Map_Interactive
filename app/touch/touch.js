(function () {
  const C = window.TCW_CONTENT;
  const params = new URLSearchParams(location.search);
  const SCREEN = [1, 2, 3].includes(+params.get('screen')) ? +params.get('screen') : 1;
  const HUB = params.get('hub') || 'localhost:8080';
  const IDLE_MS = (+params.get('idle') || 90) * 1000;
  const STAFF_PIN = params.get('pin') || '2468';
  const screen = C.screens[SCREEN];
  const $ = (sel, root = document) => root.querySelector(sel);

  let ui = { view: 'home', landmark: null, index: 0 };

  document.body.classList.toggle('flip-minimap', screen.flipMinimap);
  if (params.has('cursor')) document.body.classList.add('show-cursor');

  const hub = window.HubClient({
    url: `ws://${HUB}/hub`,
    onOpen: () => hub.send({ type: 'hello', role: 'touch', screen: SCREEN, selection: ui.landmark }),
    onMessage() {},
    onStatus(up) { document.body.dataset.hub = up ? 'up' : 'down'; },
  });

  function set(next) {
    const before = ui.landmark;
    ui = { ...ui, ...next };
    if (ui.landmark !== before) {
      hub.send(ui.landmark ? { type: 'select', screen: SCREEN, landmark: ui.landmark } : { type: 'clear', screen: SCREEN });
    }
    render();
  }

  $('#home .title').textContent = C.title;
  $('#home .zone').textContent = screen.zone;
  const zoneMap = document.createElement('img');
  zoneMap.src = `../${screen.minimap}`;
  zoneMap.alt = '';
  $('#home .minimap').appendChild(zoneMap);
  const cards = $('#home .cards');
  for (const id of screen.landmarks) {
    const l = C.landmarks[id];
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.landmark = id;
    card.innerHTML = `<span class="icon"><img src="../${l.icon}" alt=""></span><span class="label"></span>`;
    $('.label', card).textContent = l.title;
    if (l.warning) {
      const w = document.createElement('small');
      w.textContent = l.warning;
      $('.label', card).appendChild(w);
    }
    card.addEventListener('click', () => set({ view: 'detail', landmark: id, index: 0 }));
    cards.appendChild(card);
  }

  const heroImg = $('#detail .hero img');
  const lightImg = $('#lightbox img');
  const thumbs = $('#detail .thumbs');

  function showImage(img, src) {
    if (img.getAttribute('src') === src) return;
    img.classList.add('fading');
    const next = new Image();
    next.onload = next.onerror = () => { img.src = src; img.classList.remove('fading'); };
    next.src = src;
  }

  let drawnLandmark = null;
  function renderDetail(l) {
    if (drawnLandmark !== l.id) {
      drawnLandmark = l.id;
      $('#detail .name').textContent = l.title;
      $('#detail .warning').textContent = l.warning || '';
      $('#detail .body').textContent = l.body;
      document.body.classList.toggle('no-minimap', !l.minimap);
      if (l.minimap) $('#detail .minimap img').src = `../${l.minimap}`;
      document.body.classList.toggle('no-images', !l.images.length);
      document.body.classList.toggle('single-image', l.images.length === 1);
      thumbs.innerHTML = '';
      l.images.forEach((im, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.backgroundImage = `url('../${im.thumb}')`;
        b.setAttribute('aria-label', `Image ${i + 1}`);
        b.addEventListener('click', () => set({ index: i }));
        thumbs.appendChild(b);
      });
      heroImg.removeAttribute('src');
      for (const im of l.images) new Image().src = `../${im.src}`;
    }
    const im = l.images[ui.index];
    if (!im) return;
    showImage(heroImg, `../${im.src}`);
    $('#detail .counter').textContent = `${ui.index + 1} / ${l.images.length}`;
    $('#detail .credit').textContent = im.credit || '';
    [...thumbs.children].forEach((b, i) => b.classList.toggle('current', i === ui.index));
  }

  function renderLightbox(l) {
    const im = l.images[ui.index];
    showImage(lightImg, `../${im.src}`);
    $('#lightbox .counter').textContent = l.images.length > 1 ? `${ui.index + 1} / ${l.images.length}` : '';
    $('#lightbox .caption').textContent = [im.caption, im.credit].filter(Boolean).join(' · ');
    $('#lightbox').classList.toggle('single-image', l.images.length === 1);
  }

  function render() {
    const l = ui.landmark && C.landmarks[ui.landmark];
    $('#home').classList.toggle('active', ui.view === 'home');
    $('#detail').classList.toggle('active', ui.view !== 'home');
    $('#lightbox').classList.toggle('active', ui.view === 'lightbox');
    if (l) renderDetail(l);
    if (l && ui.view === 'lightbox') renderLightbox(l);
    document.body.dataset.view = ui.view;
    document.body.dataset.landmark = ui.landmark || '';
    document.body.dataset.index = ui.index;
  }

  function step(delta) {
    const n = C.landmarks[ui.landmark].images.length;
    set({ index: (ui.index + delta + n) % n });
  }

  $('#detail .back').addEventListener('click', () => set({ view: 'home', landmark: null, index: 0 }));
  $('#lightbox .close').addEventListener('click', () => set({ view: 'detail' }));
  for (const root of ['#detail .hero', '#lightbox']) {
    $(`${root} .prev`).addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
    $(`${root} .next`).addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  }

  function swipeable(el, onTap) {
    let start = null;
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) start = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      const many = C.landmarks[ui.landmark].images.length > 1;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && many) step(dx < 0 ? 1 : -1);
      else if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && onTap) onTap();
    });
    el.addEventListener('pointercancel', () => { start = null; });
  }
  swipeable($('#detail .hero'), () => set({ view: 'lightbox' }));
  swipeable($('#lightbox'));

  let idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (ui.view !== 'home') set({ view: 'home', landmark: null, index: 0 });
    }, IDLE_MS);
  }
  addEventListener('pointerdown', resetIdle, { capture: true });
  resetIdle();

  const staff = $('#staff');
  let taps = [];
  $('#staff-corner').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const now = Date.now();
    taps = taps.filter((t) => now - t < 3000).concat(now);
    if (taps.length >= 5) { taps = []; openStaff(); }
  });

  function openStaff() {
    let entered = '';
    staff.hidden = false;
    $('.status', staff).textContent = `Screen ${SCREEN} · hub ${HUB} ${document.body.dataset.hub === 'up' ? 'connected' : 'NOT connected'} · enter PIN`;
    const pin = $('.pin', staff);
    const screens = $('.screens', staff);
    pin.innerHTML = '';
    screens.innerHTML = '';
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d;
      b.addEventListener('click', () => {
        entered += d;
        if (entered === STAFF_PIN) showScreens();
        else if (entered.length >= STAFF_PIN.length) entered = '';
      });
      pin.appendChild(b);
    }
    function showScreens() {
      pin.innerHTML = '';
      $('.status', staff).textContent = 'Switch this touch screen to:';
      for (const s of [1, 2, 3]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = s === SCREEN ? `${s} ✓` : String(s);
        b.addEventListener('click', () => { params.set('screen', s); location.search = params.toString(); });
        screens.appendChild(b);
      }
      const p = document.createElement('button');
      p.type = 'button';
      p.textContent = params.has('preview') ? 'Map ✓' : 'Map';
      p.addEventListener('click', () => { params.has('preview') ? params.delete('preview') : params.set('preview', ''); location.search = params.toString(); });
      screens.appendChild(p);
    }
  }
  $('.dismiss', staff).addEventListener('click', () => { staff.hidden = true; });

  if (params.has('preview')) {
    const frame = document.createElement('iframe');
    frame.id = 'preview';
    frame.src = `http://${HUB}/projector/?preview`;
    document.body.appendChild(frame);
  }

  render();
  window.touch = { get ui() { return ui; }, set, SCREEN };
})();
