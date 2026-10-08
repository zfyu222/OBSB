/** Native clipboard when available; older mobile WebViews use a selected textarea. */
export async function copyMessage(text: string, doc: Document): Promise<void> {
  try {
    const clipboard = doc.defaultView?.navigator.clipboard;
    if (clipboard) { await clipboard.writeText(text); return; }
  } catch { /* Permission denied: try the user-initiated legacy copy action. */ }
  const active = doc.activeElement as HTMLElement | null;
  const selection = doc.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection!.getRangeAt(i).cloneRange());
  const input = doc.createElement('textarea');
  input.value = text; input.setAttribute('aria-label', '复制消息');
  input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
  doc.body.appendChild(input);
  try {
    input.focus(); input.select();
    if (!doc.execCommand?.('copy')) throw new Error('复制失败，请选中文字后使用系统复制');
  } finally {
    input.remove(); active?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
