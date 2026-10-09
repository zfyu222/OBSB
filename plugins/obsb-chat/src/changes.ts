import type { Content } from './protocol';

// OpenCode 2.0.7 returns the same per-tool patches used by its web UI.
// Render literal text, never Markdown/HTML from a patch or local file contents.
export function renderChanges(parent: HTMLElement, tool: Content): HTMLElement | undefined {
  if (tool.state?.status !== 'completed') return;
  const files = tool.state.metadata?.files;
  if (!Array.isArray(files) || !files.length) return;
  const changes = parent.createDiv('obsb-changes');
  changes.createDiv({ text: '文件修改记录', cls: 'obsb-change-heading' });
  for (const file of files) {
    if (!file || typeof file.file !== 'string') continue;
    const card = changes.createEl('details', { cls: 'obsb-change' });
    const summary = card.createEl('summary');
    summary.createSpan({ text: file.file, cls: 'obsb-change-path' });
    const counts = summary.createSpan('obsb-change-counts');
    if (Number.isFinite(file.additions)) counts.createSpan({ text: `+${file.additions}`, cls: 'obsb-add-count' });
    if (Number.isFinite(file.deletions)) counts.createSpan({ text: `−${file.deletions}`, cls: 'obsb-delete-count' });
    if (typeof file.patch !== 'string' || !file.patch) {
      card.createDiv({ text: '服务器未提供逐行差异，可在 OpenCode 页面查看操作详情。', cls: 'obsb-change-note' });
      continue;
    }
    const lines = file.patch.replace(/\r\n/g, '\n').split('\n');
    card.open = lines.length <= 100;
    const code = card.createEl('pre', { cls: 'obsb-diff', attr: { 'aria-label': `${file.file} 的修改差异` } });
    let oldLine = 0; let newLine = 0; let inHunk = false;
    for (const line of lines.slice(0, 500)) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      let kind = 'meta'; let before = ''; let after = '';
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; }
      else if (inHunk && line.startsWith('+')) { kind = 'add'; after = String(newLine++); }
      else if (inHunk && line.startsWith('-')) { kind = 'delete'; before = String(oldLine++); }
      else if (inHunk && line.startsWith(' ')) { kind = 'context'; before = String(oldLine++); after = String(newLine++); }
      const row = code.createSpan({ cls: `obsb-diff-line obsb-diff-${kind}` });
      row.createSpan({ text: before, cls: 'obsb-diff-number', attr: { 'aria-hidden': 'true' } });
      row.createSpan({ text: after, cls: 'obsb-diff-number', attr: { 'aria-hidden': 'true' } });
      row.createSpan({ text: line || ' ', cls: 'obsb-diff-text' });
    }
    if (lines.length > 500) card.createDiv({ text: '此差异较长，仅显示前 500 行；完整记录请在 OpenCode 页面查看。', cls: 'obsb-change-note' });
  }
  if (tool.state.metadata?.truncated) changes.createDiv({ text: '服务器返回的修改记录已截断，完整内容请在 OpenCode 页面查看。', cls: 'obsb-change-note' });
  return changes;
}
