import { Component, ItemView, MarkdownRenderer, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, requestUrl } from 'obsidian';
import { OpenCodeClient, type Connection } from './client';
import { copyMessage } from './clipboard';
import { applyTextDelta, chronological, commandInput, messageText, noteTarget, type Message, type Permission, type Session, type StreamPreview } from './protocol';

const VIEW = 'obsb-chat';
interface Settings extends Connection { serverVault: string; lastSession: string }
const DEFAULTS: Settings = { serverUrl: 'https://brain.hytzfy.dpdns.org:40087', username: 'opencode', password: '', directory: '/workspace', serverVault: '/workspace/vault', lastSession: '' };
type Context = { path: string; selection?: string };

export default class ObsbChatPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.registerView(VIEW, leaf => new ChatView(leaf, this));
    this.addSettingTab(new ChatSettings(this));
    this.addRibbonIcon('messages-square', '打开 AI 管家', () => { void this.openChat(); });
    this.addCommand({ id: 'open-chat', name: '打开 AI 管家', callback: () => { void this.openChat(); } });
    this.addCommand({ id: 'ask-selection', name: '将选中文字附给 AI', editorCallback: (editor, view) => {
      if (view.file && editor.getSelection()) void this.openChat({ path: view.file.path, selection: editor.getSelection() });
      else new Notice('请先选中一段笔记文字');
    } });
    this.addCommand({ id: 'ask-current-note', name: '将当前笔记附给 AI', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) void this.openChat({ path: file.path });
      return true;
    } });
  }
  client(): OpenCodeClient {
    return new OpenCodeClient({ ...this.settings }, async (url, method, headers, body) => {
      const response = await requestUrl({ url, method, headers, body, throw: false });
      return { status: response.status, text: response.text };
    });
  }
  async save(): Promise<void> { await this.saveData(this.settings); }
  currentNote(): { file: TFile; selection?: string } | null {
    // A sidebar may become the active leaf; activeEditor retains the last note.
    const editor = this.app.workspace.activeEditor;
    const file = editor?.file ?? this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return null;
    return { file, selection: editor?.editor?.getSelection() };
  }
  async openChat(context?: Context): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
    if (context && leaf.view instanceof ChatView) leaf.view.attach(context);
  }
  openSettings(): void {
    // Obsidian exposes settings navigation at runtime but not in its public types.
    const settings = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    settings.open(); settings.openTabById(this.manifest.id);
  }
}

class ChatView extends ItemView {
  private client!: OpenCodeClient;
  private sessions: Session[] = [];
  private messages = new Map<string, Message>();
  private previews = new Map<string, StreamPreview>();
  private rendered = new Map<string, { signature: string; el: HTMLElement; component: Component }>();
  private session = '';
  private sessionCursor?: string | null;
  private messageCursor?: string | null;
  private context?: Context;
  private select!: HTMLSelectElement;
  private log!: HTMLElement;
  private status!: HTMLElement;
  private permissionsEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private olderButton!: HTMLButtonElement;
  private sessionsMore!: HTMLButtonElement;
  private commands!: HTMLSelectElement;
  private timer?: number;
  private stream?: AbortController;
  private refreshInFlight = false;
  private submitting = false;
  private active = false;
  private closed = false;
  private epoch = 0;
  private streaming = false;
  private connected = false;
  private lastRefresh = 0;
  private renderQueued = false;
  private error = '';
  constructor(leaf: WorkspaceLeaf, private plugin: ObsbChatPlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'AI 管家'; }
  getIcon(): string { return 'messages-square'; }
  private button(parent: HTMLElement, text: string, callback: () => Promise<void> | void): HTMLButtonElement {
    const button = parent.createEl('button', { text });
    button.addEventListener('click', () => { void Promise.resolve().then(callback).catch(error => this.fail(error)); });
    return button;
  }
  private fail(error: unknown): void {
    if (this.closed) return;
    this.error = error instanceof Error ? error.message : '连接失败，请检查网络';
    this.status.setText(this.error); new Notice(this.error);
  }
  async onOpen(): Promise<void> {
    this.closed = false;
    const root = this.contentEl; root.empty(); root.addClass('obsb-chat');
    const toolbar = root.createDiv('obsb-toolbar');
    toolbar.createEl('strong', { text: 'AI 管家' });
    this.button(toolbar, '新对话', () => this.newSession());
    this.button(toolbar, '刷新', () => this.connect());
    this.button(toolbar, '设置', () => this.plugin.openSettings());
    const sessionBar = root.createDiv('obsb-session-bar');
    this.select = sessionBar.createEl('select', { attr: { 'aria-label': '服务器会话' } });
    this.select.addEventListener('change', () => { void this.choose(this.select.value).catch(error => this.fail(error)); });
    this.sessionsMore = this.button(sessionBar, '更多会话', () => this.loadSessions(true));
    this.sessionsMore.hidden = true;
    this.status = root.createDiv('obsb-status');
    this.olderButton = this.button(root, '加载更早消息', () => this.loadOlder()); this.olderButton.hidden = true;
    this.log = root.createDiv('obsb-messages'); this.log.setAttribute('aria-label', '聊天记录');
    this.permissionsEl = root.createDiv('obsb-permissions');
    const composer = root.createDiv('obsb-composer');
    this.contextEl = composer.createDiv('obsb-context');
    const attachments = composer.createDiv('obsb-actions');
    this.button(attachments, '当前笔记', () => {
      const note = this.plugin.currentNote();
      if (note) this.attach({ path: note.file.path }); else new Notice('请先打开一篇笔记');
    });
    this.button(attachments, '选中文字', () => {
      const note = this.plugin.currentNote();
      if (note?.selection) this.attach({ path: note.file.path, selection: note.selection });
      else new Notice('请在笔记中选中文字，或使用命令“将选中文字附给 AI”');
    });
    this.commands = attachments.createEl('select', { attr: { 'aria-label': 'OpenCode 命令' } });
    this.commands.createEl('option', { text: '选择命令…', value: '' });
    this.commands.addEventListener('change', () => {
      if (this.commands.value) { this.input.value = '/' + this.commands.value; this.input.focus(); this.commands.value = ''; }
    });
    this.input = composer.createEl('textarea', { attr: { placeholder: '问笔记、修改内容，或输入 /run-nightly', 'aria-label': '发送给 AI 的消息', rows: '3' } });
    let composing = false;
    this.input.addEventListener('compositionstart', () => { composing = true; });
    this.input.addEventListener('compositionend', () => { composing = false; });
    this.input.addEventListener('keydown', event => {
      // Some mobile IMEs report keyCode 229 instead of isComposing.
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || composing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void this.send().catch(error => this.fail(error));
    });
    const actions = composer.createDiv('obsb-actions');
    this.sendButton = this.button(actions, '发送', () => this.send()); this.sendButton.addClass('mod-cta');
    this.stopButton = this.button(actions, '停止', () => this.stop()); this.stopButton.disabled = true;
    actions.createEl('span', { text: 'Enter 发送 · Shift+Enter 换行', cls: 'obsb-shortcut' });
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) void this.connect().catch(error => this.fail(error)); });
    this.registerDomEvent(window, 'online', () => { void this.connect().catch(error => this.fail(error)); });
    await this.connect();
  }
  async onClose(): Promise<void> { this.closed = true; this.epoch++; this.stream?.abort(); window.clearTimeout(this.timer); this.clearMessages(); }
  private clearMessages(): void {
    for (const row of this.rendered.values()) this.removeChild(row.component);
    this.rendered.clear(); this.messages.clear(); this.previews.clear(); this.log?.empty(); this.messageCursor = undefined;
  }
  attach(context: Context): void {
    this.context = context; this.contextEl.empty();
    this.contextEl.createSpan({ text: context.selection ? `选段 · ${context.path}` : `笔记 · ${context.path}` });
    this.button(this.contextEl, '移除', () => { this.context = undefined; this.contextEl.empty(); });
    this.input.focus();
  }
  private controls(): void { this.sendButton.disabled = !this.connected || this.submitting || this.active; this.stopButton.disabled = !(this.active || this.submitting); this.select.disabled = this.submitting; }
  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    if (!this.closed) this.timer = window.setTimeout(() => { void this.refresh(); }, delay);
  }
  async connect(): Promise<void> {
    if (this.submitting) return;
    this.stream?.abort(); this.epoch++; window.clearTimeout(this.timer); this.streaming = false; this.connected = false; this.error = ''; this.controls();
    if (!this.plugin.settings.password) { this.status.setText('在设置中填写 OpenCode 登录密码后，点击刷新'); return; }
    const epoch = this.epoch;
    this.client = this.plugin.client(); this.status.setText('正在连接…');
    try {
      const info = await this.client.info(); if (epoch !== this.epoch || this.closed) return;
      if (!info.version.startsWith('2.')) throw new Error(`此插件需要 OpenCode 2.x，服务器版本为 ${info.version}`);
      await this.loadSessions(false);
      const commands = await this.client.commands(); if (epoch !== this.epoch || this.closed) return;
      this.commands.empty(); this.commands.createEl('option', { text: '选择命令…', value: '' });
      for (const command of commands) this.commands.createEl('option', { text: '/' + command.name, value: command.name });
      const wanted = this.sessions.find(item => item.id === this.plugin.settings.lastSession)?.id ?? this.sessions[0]?.id ?? '';
      this.connected = true;
      await this.choose(wanted);
      this.stream = new AbortController(); const signal = this.stream.signal;
      // Native requestUrl remains the authoritative transport. SSE is optional;
      // Android WebViews and CORS restrictions fall back to incremental polling.
      void this.client.subscribe(signal, event => {
        if (epoch === this.epoch && !this.closed && applyTextDelta(this.previews, event, this.session) && !this.renderQueued) {
          this.renderQueued = true;
          window.setTimeout(() => { this.renderQueued = false; if (epoch === this.epoch && !this.closed) void this.renderMessages().catch(error => this.fail(error)); }, 80);
        }
        if (epoch === this.epoch && !this.closed && Date.now() - this.lastRefresh > 700) this.schedule(100);
      }, () => { if (epoch === this.epoch) this.streaming = true; }).catch(() => {
        if (!signal.aborted && epoch === this.epoch) { this.streaming = false; this.schedule(1000); }
      });
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        this.fail(error);
        this.timer = window.setTimeout(() => { void this.connect(); }, 8000);
      }
    }
  }
  private async loadSessions(more: boolean): Promise<void> {
    const client = this.client; const epoch = this.epoch;
    const result = await client.sessions(more ? this.sessionCursor ?? undefined : undefined);
    if (epoch !== this.epoch || this.closed) return;
    this.sessions = more ? [...this.sessions, ...result.data.filter(item => !this.sessions.some(old => old.id === item.id))] : result.data;
    this.sessionCursor = result.cursor?.next;
    this.select.empty(); this.select.createEl('option', { text: '选择对话', value: '' });
    for (const session of this.sessions) this.select.createEl('option', { text: session.title || '未命名对话', value: session.id });
    this.select.value = this.session; this.sessionsMore.hidden = !this.sessionCursor;
  }
  private async choose(id: string): Promise<void> {
    if (id !== this.session) { this.clearMessages(); this.context = undefined; this.contextEl.empty(); this.input.value = ''; }
    this.session = id; this.select.value = id; this.plugin.settings.lastSession = id; await this.plugin.save();
    this.permissionsEl.empty(); this.active = false; this.controls();
    await this.refresh();
  }
  private async newSession(): Promise<void> {
    if (!this.connected || this.submitting) return;
    const session = await this.client.create('Obsidian 对话 ' + new Date().toLocaleString('zh-CN'));
    await this.loadSessions(false); await this.choose(session.id); this.input.focus();
  }
  private async refresh(): Promise<void> {
    if (this.closed || !this.connected) return;
    if (this.refreshInFlight) { this.schedule(300); return; }
    if (!this.session) { this.status.setText('已连接，点击“新对话”开始'); return; }
    const id = this.session; const epoch = this.epoch;
    this.refreshInFlight = true; this.lastRefresh = Date.now();
    try {
      const [result, active, permissions] = await Promise.all([this.client.messages(id), this.client.active(), this.client.permissions(id)]);
      if (id !== this.session || epoch !== this.epoch || this.closed) return;
      this.error = ''; this.active = id in active;
      // Refresh the newest page without throwing away explicitly loaded history.
      for (const message of result.data) {
        this.messages.set(message.id, message);
        if (message.time?.completed) this.previews.delete(message.id);
      }
      if (this.messageCursor === undefined) this.messageCursor = result.cursor?.next ?? null;
      await this.renderMessages(); this.showPermissions(permissions, id);
      this.status.setText(permissions.length ? '等待你处理操作请求' : this.active ? (this.streaming ? 'AI 正在回复…' : 'AI 正在回复 · 自动刷新') : '已连接');
    } catch (error) { if (epoch === this.epoch && id === this.session && !this.closed) this.status.setText(error instanceof Error ? error.message : '连接中断，正在重试'); }
    finally { this.refreshInFlight = false; this.controls(); this.schedule(this.active ? 1500 : 8000); }
  }
  private async loadOlder(): Promise<void> {
    if (!this.messageCursor) return;
    const id = this.session; const epoch = this.epoch;
    const page = await this.client.messages(id, this.messageCursor);
    if (id !== this.session || epoch !== this.epoch || this.closed) return;
    this.messageCursor = page.cursor?.next ?? null;
    for (const message of page.data) this.messages.set(message.id, message);
    const height = this.log.scrollHeight; const top = this.log.scrollTop;
    await this.renderMessages(false); this.log.scrollTop = top + this.log.scrollHeight - height;
  }
  private showPermissions(permissions: Permission[], id: string): void {
    this.permissionsEl.empty();
    for (const permission of permissions) {
      const row = this.permissionsEl.createDiv('obsb-permission');
      row.createEl('strong', { text: 'OpenCode 请求操作：' + permission.action });
      row.createEl('pre', { text: permission.resources.join('\n') });
      this.button(row, '允许这一次', async () => { await this.client.reply(id, permission.id, 'once'); await this.refresh(); });
      this.button(row, '拒绝', async () => { await this.client.reply(id, permission.id, 'reject'); await this.refresh(); });
    }
  }
  private async renderMessages(scroll = true): Promise<void> {
    const pinned = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 100;
    const id = this.session; const epoch = this.epoch;
    const visible = new Map(this.messages);
    for (const preview of this.previews.values()) {
      const snapshot = visible.get(preview.id);
      if (!snapshot || messageText(snapshot).length < preview.text.length) visible.set(preview.id, { ...snapshot, id: preview.id, type: 'assistant', time: snapshot?.time ?? { created: preview.created }, content: [{ type: 'text', text: preview.text }] });
    }
    for (const message of chronological([...visible.values()])) {
      if (!['user', 'assistant'].includes(message.type)) continue;
      const text = messageText(message);
      const signature = JSON.stringify(message);
      let row = this.rendered.get(message.id);
      if (row?.signature === signature) continue;
      if (row) this.removeChild(row.component);
      const el = row?.el ?? this.log.createDiv('obsb-message'); el.empty();
      el.addClass(message.type === 'user' ? 'obsb-user' : 'obsb-assistant');
      const header = el.createDiv('obsb-message-header');
      header.createDiv({ text: message.type === 'user' ? '你' : 'AI 管家', cls: 'obsb-role' });
      const copy = this.button(header, '复制', async () => {
        try { await copyMessage(text, el.ownerDocument); new Notice('消息已复制'); }
        catch (error) { new Notice(error instanceof Error ? error.message : '复制失败'); }
      });
      copy.addClass('obsb-copy'); copy.setAttribute('aria-label', message.type === 'user' ? '复制消息' : '复制回答');
      const component = new Component(); this.addChild(component);
      row = { signature, el, component }; this.rendered.set(message.id, row);
      const body = el.createDiv('obsb-body');
      const source = this.context?.path ?? '';
      await MarkdownRenderer.render(this.app, text, body, source, component);
      if (id !== this.session || epoch !== this.epoch || this.closed) return;
      this.wireLinks(body, source, component);
      for (const tool of message.content?.filter(part => part.type === 'tool') ?? []) {
        el.createDiv({ text: `${tool.name ?? '操作'} · ${tool.state?.status === 'completed' ? '完成' : tool.state?.status === 'error' ? '失败' : '执行中'}`, cls: 'obsb-tool' });
      }
      if (message.error) el.createDiv({ text: message.error.message ?? 'AI 调用失败', cls: 'obsb-error' });
    }
    // Reorder existing rows when older pages arrive without recreating unchanged Markdown.
    let index = 0;
    for (const message of chronological([...visible.values()])) {
      const row = this.rendered.get(message.id); if (!row) continue;
      const current = this.log.children.item(index++);
      // Moving even an unchanged DOM node clears the user's text selection.
      if (current !== row.el) this.log.insertBefore(row.el, current);
    }
    this.olderButton.hidden = !this.messageCursor;
    if (scroll && pinned) this.log.scrollTop = this.log.scrollHeight;
  }
  private wireLinks(body: HTMLElement, source: string, component: Component): void {
    for (const code of body.querySelectorAll('code')) {
      if (code.closest('pre')) continue;
      const raw = code.textContent ?? '';
      if (/^(?:\/?workspace\/vault\/|vault\/)?(?:Raw|InBox|Drived)\/.+\.md(?:#.*)?$/.test(raw)) {
        const link = document.createElement('a'); link.textContent = raw; link.dataset.obsbTarget = raw; link.addClass('internal-link'); code.replaceWith(link);
      }
    }
    component.registerDomEvent(body, 'click', event => {
      const link = (event.target as Element).closest('a'); if (!link || !body.contains(link)) return;
      const raw = link.dataset.obsbTarget ?? link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      const target = noteTarget(raw, this.plugin.settings.serverVault);
      if (!target) {
        if (link.classList.contains('internal-link')) { event.preventDefault(); event.stopPropagation(); new Notice('这不是可打开的 Markdown 笔记路径'); }
        return;
      }
      event.preventDefault(); event.stopPropagation();
      const path = target.split('#')[0];
      const file = this.app.metadataCache.getFirstLinkpathDest(path, source);
      if (!(file instanceof TFile) || file.extension !== 'md') { new Notice('本地尚未找到这篇笔记，请等待 LiveSync 同步：' + path); return; }
      void this.app.workspace.openLinkText(target, source, true).catch(error => this.fail(error));
    }, { capture: true });
  }
  private async send(): Promise<void> {
    const text = this.input.value.trim(); if (!text || this.submitting || this.active) return;
    if (!this.connected || !this.plugin.settings.password) { this.plugin.openSettings(); return; }
    this.submitting = true; this.controls();
    try {
      if (!this.session) await this.newSessionForSend();
      const id = this.session; const context = this.context;
      const command = commandInput(text);
      if (command) {
        if (context) throw new Error('执行命令前请移除附加笔记或选段');
        const commands = await this.client.commands();
        if (!commands.some(item => item.name === command.name)) throw new Error('服务器没有这个命令：/' + command.name);
        await this.client.command(id, command.name, command.text);
      } else {
        const attached = context ? `\n\n附加上下文（用户选中的笔记材料）：\n笔记路径：vault/${context.path}\n${context.selection ? '选中文字：\n' + context.selection : '请按需要读取服务器已同步的这篇笔记。'}` : '';
        await this.client.prompt(id, text + attached);
      }
      this.input.value = ''; this.context = undefined; this.contextEl.empty(); this.active = true; this.status.setText('已发送，AI 正在处理…'); this.schedule(300);
    } finally { this.submitting = false; this.controls(); }
  }
  private async newSessionForSend(): Promise<void> {
    const session = await this.client.create('Obsidian 对话 ' + new Date().toLocaleString('zh-CN'));
    await this.loadSessions(false); this.session = session.id; this.select.value = session.id;
    this.plugin.settings.lastSession = session.id; await this.plugin.save();
  }
  private async stop(): Promise<void> { if (this.session) { await this.client.interrupt(this.session); this.schedule(300); } }
}

class ChatSettings extends PluginSettingTab {
  constructor(private plugin: ObsbChatPlugin) { super(plugin.app, plugin); }
  display(): void {
    this.containerEl.empty(); this.containerEl.createEl('h2', { text: 'AI 管家连接' });
    this.containerEl.createEl('p', { text: '连接现有 NAS OpenCode。保存后在聊天面板点击“刷新”。' });
    const field = (name: string, key: keyof Settings, description: string, secret = false) => {
      new Setting(this.containerEl).setName(name).setDesc(description).addText(text => {
        text.setValue(this.plugin.settings[key]); if (secret) text.inputEl.type = 'password';
        text.onChange(async value => {
          this.plugin.settings[key] = secret ? value : value.trim();
          if (key === 'serverUrl' || key === 'directory') this.plugin.settings.lastSession = '';
          await this.plugin.save();
        });
      });
    };
    field('服务器地址', 'serverUrl', '现有 OpenCode HTTPS 地址，无需添加 /api。');
    field('用户名', 'username', '当前部署使用 opencode。');
    field('登录密码', 'password', '保存在本机插件配置中；不填写 DeepSeek API Key。', true);
    field('服务器项目目录', 'directory', '日常对话使用 /workspace，避免混入 nightly 项目。');
    field('服务器笔记根目录', 'serverVault', '默认 /workspace/vault，用于把服务器路径转换成本地笔记链接。');
    new Setting(this.containerEl).setName('测试连接').addButton(button => button.setButtonText('测试').onClick(async () => {
      try { const info = await this.plugin.client().info(); new Notice('连接成功 · OpenCode ' + info.version); }
      catch (error) { new Notice(error instanceof Error ? error.message : '连接失败'); }
    }));
  }
}
