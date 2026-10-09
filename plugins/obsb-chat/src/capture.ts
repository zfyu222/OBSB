import { Modal, Notice, TFolder, TFile, type App } from 'obsidian';

export interface CaptureState { draft: string; pending?: { path: string; content: string } }
export function captureUri(vault: string): string { return `obsidian://obsb-capture?vault=${encodeURIComponent(vault)}`; }

function filename(now: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `灵感-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

export async function saveCapture(app: App, state: CaptureState, persist: () => Promise<void>, now = new Date()): Promise<string> {
  if (!state.draft.trim()) throw new Error('请先输入要记录的内容');
  const content = state.draft.endsWith('\n') ? state.draft : state.draft + '\n';
  const inbox = app.vault.getAbstractFileByPath('InBox');
  if (inbox && !(inbox instanceof TFolder)) throw new Error('InBox 已被同名文件占用，请先处理后重试');
  if (!inbox) {
    try { await app.vault.createFolder('InBox'); }
    catch (error) { if (!(app.vault.getAbstractFileByPath('InBox') instanceof TFolder)) throw error; }
  }
  // Persist an exact target before writing. If the file write succeeded but its
  // response or draft cleanup failed, retry can recognize that same capture.
  let path = state.pending?.content === content && /^InBox\/灵感-[\d-]+\.md$/.test(state.pending.path) ? state.pending.path : '';
  if (!path) {
    const base = `InBox/${filename(now)}`; path = base + '.md'; let suffix = 2;
    while (app.vault.getAbstractFileByPath(path)) path = `${base}-${suffix++}.md`;
    state.pending = { path, content };
  }
  await persist();
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) {
    if (!(existing instanceof TFile) || await app.vault.read(existing) !== content) {
      delete state.pending; await persist();
      throw new Error('记录目标已被其他内容占用，未覆盖；再次保存会生成新文件名');
    }
  } else {
    try { await app.vault.create(path, content); }
    catch (error) {
      const written = app.vault.getAbstractFileByPath(path);
      if (!(written instanceof TFile) || await app.vault.read(written) !== content) throw error;
    }
  }
  const previous = { draft: state.draft, pending: state.pending };
  state.draft = ''; delete state.pending;
  try { await persist(); }
  catch (error) {
    state.draft = previous.draft; state.pending = previous.pending;
    throw new Error(`笔记已保存，但草稿清理失败；重试不会重复创建：${error instanceof Error ? error.message : '存储错误'}`);
  }
  return path;
}

export class CaptureModal extends Modal {
  saving = false;
  private opened = false;
  private input!: HTMLTextAreaElement;
  private error!: HTMLElement;
  private draftTimer?: number;
  private focusTimer?: number;
  constructor(app: App, private state: CaptureState, private persist: () => Promise<void>, private finished: () => void) { super(app); }
  onOpen(): void {
    this.opened = true; this.contentEl.addClass('obsb-capture');
    this.contentEl.createEl('h3', { text: '一键记录' });
    this.contentEl.createEl('p', { text: '直接保存到 Inbox，文件名自动生成。', cls: 'obsb-status' });
    this.input = this.contentEl.createEl('textarea', { attr: { rows: '7', placeholder: '记下刚刚的灵感…', 'aria-label': '灵感内容' } });
    this.input.value = this.state.draft;
    this.error = this.contentEl.createDiv('obsb-error'); this.error.setAttribute('role', 'alert');
    this.input.addEventListener('input', () => {
      this.state.draft = this.input.value;
      // Editing a previous attempted capture starts a new target; an unchanged
      // retry keeps the persisted target for recovery.
      if (this.state.pending && this.state.pending.content !== (this.input.value.endsWith('\n') ? this.input.value : this.input.value + '\n')) delete this.state.pending;
      window.clearTimeout(this.draftTimer);
      this.draftTimer = window.setTimeout(() => { void this.persist().catch(error => this.showError(error)); }, 250);
    });
    const actions = this.contentEl.createDiv('obsb-actions');
    const later = actions.createEl('button', { text: '稍后再写' }); later.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { text: '保存', cls: 'mod-cta' });
    const submit = async () => {
      if (this.saving) return;
      this.state.draft = this.input.value; window.clearTimeout(this.draftTimer);
      this.saving = true; this.input.disabled = save.disabled = later.disabled = true; this.error.empty();
      try {
        await saveCapture(this.app, this.state, this.persist);
        new Notice('已保存到 Inbox'); this.input.value = ''; this.close();
      } catch (error) { this.showError(error); }
      finally {
        this.saving = false; this.input.disabled = save.disabled = later.disabled = false;
        if (!this.opened) this.finished(); else this.focus();
      }
    };
    save.addEventListener('click', () => { void submit(); });
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit(); }
    });
    this.focus();
    // Some mobile WebViews do not honor focus until the modal has been attached.
    this.focusTimer = window.setTimeout(() => { if (this.opened) this.focus(); }, 100);
  }
  focus(): void { this.input?.focus(); }
  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : '保存失败，内容已保留';
    if (this.opened) this.error.setText(message); else new Notice(message);
  }
  onClose(): void {
    this.opened = false; window.clearTimeout(this.draftTimer); window.clearTimeout(this.focusTimer);
    if (!this.saving) { this.state.draft = this.input.value; void this.persist().catch(error => this.showError(error)); this.finished(); }
    this.contentEl.empty();
  }
}
