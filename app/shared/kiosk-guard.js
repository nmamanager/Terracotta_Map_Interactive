(function () {
  const style = document.createElement('style');
  style.textContent = `
    html, body, * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
    html, body { touch-action: none; overscroll-behavior: none; }
    img { pointer-events: none; }
  `;
  document.head.appendChild(style);

  const block = (e) => e.preventDefault();
  addEventListener('contextmenu', block, { capture: true });
  addEventListener('dragstart', block, { capture: true });
  addEventListener('selectstart', block, { capture: true });
  addEventListener('gesturestart', block, { capture: true });
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { capture: true, passive: false });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && ['+', '-', '=', '0', 'p', 's', 'o'].includes(e.key.toLowerCase())) e.preventDefault();
  }, { capture: true });

  addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
  addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { capture: true, passive: false });

  // Clear selection and focus before Chrome's ~500ms long-press UI can latch onto anything.
  let lpTimer = null;
  const clearLP = () => { clearTimeout(lpTimer); lpTimer = null; };
  const armLP = (e) => {
    clearLP();
    if (e.touches && e.touches.length > 1) return;
    lpTimer = setTimeout(() => {
      try { getSelection().removeAllRanges(); } catch (err) {}
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }, 300);
  };
  for (const t of ['pointerdown', 'touchstart']) addEventListener(t, armLP, { capture: true, passive: true });
  for (const t of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'pointermove']) addEventListener(t, clearLP, { capture: true, passive: true });
})();
