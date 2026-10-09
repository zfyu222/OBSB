// Obsidian's floating navbar overlays custom views. Reserve only the part of
// this view actually covered by it or by the reduced visual viewport.
export function avoidMobileOverlays(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  let frame = 0;
  let closed = false;
  const update = () => {
    frame = 0;
    if (closed) return;
    const rect = root.getBoundingClientRect();
    if (!rect.height || !rect.width) return;
    const viewport = win.visualViewport;
    const bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : win.innerHeight);
    let boundary = bottom;
    for (const bar of doc.querySelectorAll<HTMLElement>('.mobile-navbar')) {
      const style = win.getComputedStyle(bar);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const box = bar.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < bottom) {
        boundary = Math.min(boundary, Math.max(rect.top, box.top));
      }
    }
    const value = `${Math.ceil(Math.max(0, rect.bottom - boundary))}px`;
    if (root.style.getPropertyValue('--obsb-bottom-obstruction') !== value) root.style.setProperty('--obsb-bottom-obstruction', value);
  };
  const schedule = () => { if (!closed && !frame) frame = win.requestAnimationFrame(update); };
  win.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('scroll', schedule);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  doc.addEventListener('transitionend', schedule);
  doc.addEventListener('animationend', schedule);
  // Navbar visibility/position can change without a window resize.
  const observer = new win.MutationObserver(records => {
    if (records.some(record => record.target !== root && !root.contains(record.target))) schedule();
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : undefined;
  resize?.observe(root);
  update();
  return () => {
    closed = true;
    if (frame) win.cancelAnimationFrame(frame);
    observer.disconnect(); resize?.disconnect();
    win.removeEventListener('resize', schedule);
    win.visualViewport?.removeEventListener('resize', schedule);
    win.visualViewport?.removeEventListener('scroll', schedule);
    doc.removeEventListener('focusin', schedule); doc.removeEventListener('focusout', schedule);
    doc.removeEventListener('transitionend', schedule); doc.removeEventListener('animationend', schedule);
    root.style.removeProperty('--obsb-bottom-obstruction');
  };
}
