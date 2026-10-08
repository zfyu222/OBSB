import { Modal, type App } from 'obsidian';
import { type Session } from './protocol';

export class ConfirmAction extends Modal {
  private busy = false;
  constructor(app: App, private title: string, private detail: string, private action: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h3', { text: this.title });
    this.contentEl.createEl('p', { text: this.detail });
    const error = this.contentEl.createDiv('obsb-error'); error.setAttribute('role', 'alert');
    const actions = this.contentEl.createDiv('obsb-actions');
    const cancel = actions.createEl('button', { text: '取消' }); cancel.addEventListener('click', () => this.close());
    const confirm = actions.createEl('button', { text: '确认删除', cls: 'mod-warning' });
    confirm.addEventListener('click', () => {
      if (this.busy) return;
      this.busy = true; confirm.disabled = true; cancel.disabled = true;
      void this.action().then(() => this.close()).catch(reason => {
        error.setText(reason instanceof Error ? reason.message : '删除失败，请重试');
      }).finally(() => { this.busy = false; confirm.disabled = false; cancel.disabled = false; });
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

export class SessionManager extends Modal {
  private disposed = false;
  constructor(app: App, private directory: string, private load: () => Promise<Session[]>, private remove: (sessions: Session[]) => Promise<void>) { super(app); }
  onOpen(): void { this.disposed = false; void this.render(); }
  private async render(): Promise<void> {
    this.contentEl.empty(); this.contentEl.addClass('obsb-session-manager');
    this.contentEl.createEl('h3', { text: '管理对话' });
    this.contentEl.createEl('p', { text: `仅显示当前项目 ${this.directory}。删除会从服务器移除对话及其子对话，其他设备也会生效；不会撤销已经修改的笔记。` });
    const status = this.contentEl.createDiv({ text: '正在读取全部对话…', cls: 'obsb-status' });
    let sessions: Session[];
    try { sessions = await this.load(); }
    catch (error) { if (!this.disposed) status.setText(error instanceof Error ? error.message : '加载失败，请关闭后重试'); return; }
    if (this.disposed) return;
    status.setText(`共 ${sessions.length} 个对话`);
    const search = this.contentEl.createEl('input', { attr: { type: 'search', placeholder: '搜索对话标题', 'aria-label': '搜索对话标题' } });
    const list = this.contentEl.createDiv('obsb-session-list'); const selected = new Set<string>();
    const actions = this.contentEl.createDiv('obsb-actions');
    const all = actions.createEl('button', { text: '全选当前项目' });
    const none = actions.createEl('button', { text: '取消选择' });
    const remove = actions.createEl('button', { text: '删除选中（0）', cls: 'mod-warning' }); remove.disabled = true;
    const draw = () => {
      list.empty();
      for (const session of sessions.filter(item => (item.title || '未命名对话').toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
        const row = list.createEl('label', { cls: 'obsb-session-row' });
        const input = row.createEl('input', { attr: { type: 'checkbox' } }); input.checked = selected.has(session.id);
        row.createSpan({ text: session.title || '未命名对话' });
        input.addEventListener('change', () => { if (input.checked) selected.add(session.id); else selected.delete(session.id); count(); });
      }
      count();
    };
    const count = () => { remove.setText(`删除选中（${selected.size}）`); remove.disabled = !selected.size; };
    search.addEventListener('input', draw);
    all.addEventListener('click', () => { for (const session of sessions) selected.add(session.id); draw(); });
    none.addEventListener('click', () => { selected.clear(); draw(); });
    remove.addEventListener('click', () => {
      const targets = sessions.filter(session => selected.has(session.id));
      new ConfirmAction(this.app, `删除 ${targets.length} 个对话？`,
        `将永久删除以下服务器对话及其子对话，无法在插件中恢复：\n${targets.map(session => session.title || '未命名对话').join('\n')}`,
        async () => { try { await this.remove(targets); } finally { if (!this.disposed) await this.render(); } }).open();
    });
    draw();
  }
  onClose(): void { this.disposed = true; this.contentEl.empty(); }
}
