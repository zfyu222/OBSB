import { Component, ItemView, MarkdownRenderer, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, requestUrl } from 'obsidian';
import { ApiError, OpenCodeClient, type Connection } from './client';
import { FormCards } from './forms';
import { ConfirmAction, SessionManager } from './sessions';
import { copyMessage } from './clipboard';
import { CaptureModal, captureUri, type CaptureState } from './capture';
import { applyTextDelta, chatUri, chronological, commandInput, messageText, noteTarget, type Message, type Permission, type Session, type StreamPreview } from './protocol';

const VIEW = 'obsb-chat';
interface Settings extends Connection { serverVault: string; lastSession: string; capture?: CaptureState }
const DEFAULTS: Settings = { serverUrl: '', username: 'opencode', password: '', directory: '/workspace', serverVault: '/workspace/vault', lastSession: '' };
type Context = { path: string; selection?: string };

export default class ObsbChatPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private captureModal?: CaptureModal;
  private captureQueued = false;
  private chatQueued = false;
  private unloaded = false;
  private saveQueue: Promise<void> = Promise.resolve();
  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.unloaded = false;
    this.settings.capture = { draft: '', ...this.settings.capture };
    this.registerObsidianProtocolHandler('obsb-capture', params => {
      if (params.vault && params.vault !== this.app.vault.getName()) { new Notice('请先打开桌面链接指定的仓库，再点击一键记录'); return; }
      this.openCapture();
    });
    this.addCommand({ id: 'quick-capture', name: '一键记录到 Inbox', callback: () => this.openCapture() });
    this.addCommand({ id: 'copy-capture-link', name: '复制一键记录桌面链接', callback: () => { void this.copyCaptureLink(); } });
    this.addRibbonIcon('pencil', '一键记录', () => this.openCapture());
    this.registerView(VIEW, leaf => new ChatView(leaf, this));
    this.registerObsidianProtocolHandler('obsb-chat', params => {
      if (params.vault && params.vault !== this.app.vault.getName()) { new Notice('请先打开桌面链接指定的仓库，再打开 AI 管家'); return; }
      this.openChatShortcut();
    });
    this.addCommand({ id: 'copy-chat-link', name: '复制 AI 管家桌面链接', callback: () => { void this.copyChatLink(); } });
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
  save(): Promise<void> {
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData({ ...this.settings, capture: this.settings.capture ? { ...this.settings.capture, pending: this.settings.capture.pending ? { ...this.settings.capture.pending } : undefined } : undefined }));
    return this.saveQueue;
  }
  openCapture(): void {
    if (this.unloaded) return;
    if (this.captureModal) { if (this.captureModal.saving) new Notice('正在保存上一条记录，请稍候'); else this.captureModal.focus(); return; }
    if (this.captureQueued) return;
    this.captureQueued = true;
    this.app.workspace.onLayoutReady(() => {
      this.captureQueued = false; if (this.unloaded || this.captureModal) return;
      const state = this.settings.capture ?? (this.settings.capture = { draft: '' });
      this.captureModal = new CaptureModal(this.app, state, () => this.save(), () => { this.captureModal = undefined; });
      this.captureModal.open();
    });
  }
  async copyCaptureLink(): Promise<void> {
    try { await copyMessage(captureUri(this.app.vault.getName()), document); new Notice('已复制桌面链接；快捷方式名称设为“一键记录”'); }
    catch (error) { new Notice(error instanceof Error ? error.message : '复制失败'); }
  }
  openChatShortcut(): void {
    if (this.unloaded || this.chatQueued) return;
    this.chatQueued = true;
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) { this.chatQueued = false; return; }
      void this.openChat().catch(error => {
        new Notice(error instanceof Error ? error.message : '打开 AI 管家失败');
      }).finally(() => { this.chatQueued = false; });
    });
  }
  async copyChatLink(): Promise<void> {
    try { await copyMessage(chatUri(this.app.vault.getName()), document); new Notice('已复制桌面链接；快捷方式名称设为“OBSB AI 管家”'); }
    catch (error) { new Notice(error instanceof Error ? error.message : '复制失败'); }
  }
  onunload(): void { this.unloaded = true; this.captureModal?.close(); }
  currentNote(): { file: TFile; selection?: string } | null {
    // A sidebar may become the active leaf; activeEditor retains the last note.
    const editor = this.app.workspace.activeEditor;
    const file = editor?.file ?? this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return null;
    return { file, selection: editor?.editor?.getSelection() };
  }
  async openChat(context?: Context): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(VIEW)[0];
    // Upgrade previously restored mobile sidebar views to a full-width tab.
    if (Platform.isMobile && leaf && leaf.getRoot() !== this.app.workspace.rootSplit) { leaf.detach(); leaf = undefined; }
    if (!leaf) { leaf = Platform.isMobile ? this.app.workspace.getLeaf('tab') : this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW, active: true }); }
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
  private formsEl!: HTMLElement;
  private forms!: FormCards;
  private pendingForms = 0;
  private manageButton!: HTMLButtonElement;
  private compactButton!: HTMLButtonElement;
  private clearButton!: HTMLButtonElement;
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
    this.manageButton = this.button(sessionBar, '管理', () => this.manageSessions());
    this.status = root.createDiv('obsb-status');
    this.olderButton = this.button(root, '加载更早消息', () => this.loadOlder()); this.olderButton.hidden = true;
    this.log = root.createDiv('obsb-messages'); this.log.setAttribute('aria-label', '聊天记录');
    this.permissionsEl = root.createDiv('obsb-permissions');
    this.formsEl = root.createDiv('obsb-forms');
    this.forms = new FormCards(this.formsEl, async (form, answer) => {
      const id = this.session; const client = this.client;
      if (form.sessionID !== id || !this.connected) throw new Error('对话已切换或连接中断，请刷新后重试');
      try {
        if (answer === undefined) await client.cancelForm(id, form.id);
        else await client.answerForm(id, form.id, answer);
      } catch (error) {
        // Another device may already have answered this form. Reconcile rather
        // than keeping a stale card that can never be submitted successfully.
        if (error instanceof ApiError && [404, 409].includes(error.status)) await this.refresh();
        throw error;
      }
      await this.refresh();
    });
    const composer = root.createDiv('obsb-composer');
    this.contextEl = composer.createDiv('obsb-context');
    const extras = composer.createEl('details', { cls: 'obsb-extras' });
    extras.open = !Platform.isMobile;
    extras.createEl('summary', { text: '附加笔记 / 命令' });
    const attachments = extras.createDiv('obsb-actions');
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
    this.compactButton = this.button(attachments, '压缩历史', () => this.compactSession());
    this.clearButton = this.button(attachments, '清空当前对话', () => this.confirmClear());
    this.input = composer.createEl('textarea', { attr: { placeholder: '问笔记、修改内容，或输入 /run-nightly', 'aria-label': '发送给 AI 的消息', rows: '3' } });
    const resizeInput = () => {
      if (!Platform.isMobile) return;
      this.input.style.height = '44px';
      this.input.style.height = Math.min(104, Math.max(44, this.input.scrollHeight)) + 'px';
    };
    this.input.addEventListener('input', resizeInput);
    let composing = false;
    this.input.addEventListener('compositionstart', () => { composing = true; });
    this.input.addEventListener('compositionend', () => { composing = false; });
    this.input.addEventListener('keydown', event => {
      // Some mobile IMEs report keyCode 229 instead of isComposing.
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || composing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void this.send().catch(error => this.fail(error));
    });
    const actions = composer.createDiv('obsb-actions obsb-send-actions');
    this.sendButton = this.button(actions, '发送', () => this.send()); this.sendButton.addClass('mod-cta');
    this.stopButton = this.button(actions, '停止', () => this.stop()); this.stopButton.addClass('obsb-stop'); this.stopButton.disabled = true;
    actions.createEl('span', { text: 'Enter 发送 · Shift+Enter 换行', cls: 'obsb-shortcut' });
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) void this.connect().catch(error => this.fail(error)); });
    this.registerDomEvent(window, 'online', () => { void this.connect().catch(error => this.fail(error)); });
    await this.connect();
  }
  async onClose(): Promise<void> { this.closed = true; this.epoch++; this.stream?.abort(); window.clearTimeout(this.timer); this.forms?.clear(); this.clearMessages(); }
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
  private controls(): void {
    this.sendButton.disabled = !this.connected || this.submitting || this.active || this.pendingForms > 0;
    this.stopButton.disabled = !(this.active || this.submitting); this.select.disabled = this.submitting;
    this.manageButton.disabled = !this.connected || this.submitting;
    this.compactButton.disabled = this.clearButton.disabled = !this.connected || !this.session || this.submitting || this.active || this.pendingForms > 0;
  }
  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    if (!this.closed) this.timer = window.setTimeout(() => { void this.refresh(); }, delay);
  }
  async connect(): Promise<void> {
    if (this.submitting) return;
    this.stream?.abort(); this.epoch++; window.clearTimeout(this.timer); this.streaming = false; this.connected = false; this.error = ''; this.controls();
    if (!this.plugin.settings.serverUrl || !this.plugin.settings.password) { this.status.setText('在设置中填写 OpenCode 服务器地址和登录密码后，点击刷新'); return; }
    const epoch = this.epoch;
    this.client = this.plugin.client(); this.status.setText('正在连接…');
    try {
      const info = await this.client.info(); if (epoch !== this.epoch || this.closed) return;
      if (!info.version.startsWith('2.')) throw new Error(`此插件需要 OpenCode 2.x，服务器版本为 ${info.version}`);
      await this.loadSessions(false);
      const commands = await this.client.commands(); if (epoch !== this.epoch || this.closed) return;
      this.commands.empty(); this.commands.createEl('option', { text: '选择命令…', value: '' });
      this.commands.createEl('option', { text: '/compact · 压缩对话历史', value: 'compact' });
      for (const command of commands.filter(command => command.name !== 'compact')) this.commands.createEl('option', { text: '/' + command.name + (command.description ? ' · ' + command.description : ''), value: command.name });
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
    if (id !== this.session) { this.clearMessages(); this.forms.clear(); this.pendingForms = 0; this.context = undefined; this.contextEl.empty(); this.input.value = ''; }
    this.session = id; this.select.value = id; this.plugin.settings.lastSession = id; await this.plugin.save();
    this.permissionsEl.empty(); this.active = false; this.controls();
    await this.refresh();
  }
  private async newSession(): Promise<void> {
    if (!this.connected || this.submitting) return;
    const session = await this.client.create();
    await this.loadSessions(false); await this.choose(session.id); this.input.focus();
  }
  private manageSessions(): void {
    if (!this.connected || this.submitting) return;
    const client = this.client;
    new SessionManager(this.app, client.connection.directory, () => client.allSessions(), async targets => {
      if (!this.sameConnection(client)) throw new Error('连接设置已变化，请重新打开对话管理');
      await this.deleteSessions(targets);
    }).open();
  }
  private sameConnection(client: OpenCodeClient): boolean {
    return (['serverUrl', 'username', 'password', 'directory'] as const).every(key => client.connection[key] === this.client.connection[key]);
  }
  private confirmClear(): void {
    if (!this.connected || !this.session || this.submitting || this.active || this.pendingForms) return;
    const client = this.client;
    const session = this.sessions.find(item => item.id === this.session);
    if (!session) return;
    new ConfirmAction(this.app, '清空当前对话？',
      `将永久删除“${session.title || '未命名对话'}”及其子对话的服务器记录，然后开始一个空白新对话。其他设备也会生效；已修改的笔记保持现状。`,
      async () => {
        if (!this.sameConnection(client) || session.id !== this.session) throw new Error('当前对话已变化，请重新选择清空');
        await this.deleteSessions([session], true);
      }).open();
  }
  private async deleteSessions(targets: Session[], replace = false): Promise<void> {
    if (!this.connected || this.submitting) throw new Error('正在执行其他操作，请稍后重试');
    const client = this.client; const removed = new Set<string>(); let failure: unknown; let mutationStarted = false;
    this.submitting = true; this.controls();
    try {
      const all = await client.allSessions();
      const selected = new Set(targets.map(target => target.id));
      for (const target of targets) if (target.location?.directory !== client.connection.directory) throw new Error('只能删除当前项目的对话');
      // Deleting a parent also removes descendants. Include them when checking
      // active work and reconciling the current selection after deletion.
      const affected = new Set(selected);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const session of all) if (session.parentID && affected.has(session.parentID) && !affected.has(session.id)) { affected.add(session.id); expanded = true; }
      }
      const active = await client.active();
      if (Object.keys(active).some(id => affected.has(id))) throw new Error('所选对话或其子对话正在运行，请先停止后再删除');
      for (const target of targets) {
        try {
          const current = await client.session(target.id);
          if (current.location?.directory !== client.connection.directory) throw new Error('对话所属项目已变化，已停止删除');
          const running = await client.active();
          if (Object.keys(running).some(id => affected.has(id))) throw new Error('对话开始运行，已停止删除；请先停止后重试');
          mutationStarted = true; await client.remove(target.id);
        } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        removed.add(target.id);
        // Mark only descendants of a successfully deleted target as removed.
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const session of all) if (session.parentID && removed.has(session.parentID) && !removed.has(session.id)) { removed.add(session.id); expanded = true; }
        }
      }
      if (replace) {
        const fresh = await client.create();
        this.plugin.settings.lastSession = fresh.id;
      }
    } catch (error) { failure = error; }
    finally {
      if (removed.has(this.session)) {
        this.session = ''; this.clearMessages(); this.forms.clear(); this.pendingForms = 0;
        this.context = undefined; this.contextEl.empty(); this.input.value = '';
        if (removed.has(this.plugin.settings.lastSession)) this.plugin.settings.lastSession = '';
      }
      this.submitting = false;
      if (removed.size) await this.plugin.save();
      // A transport failure can happen after the server has accepted deletion.
      // Refresh actual state even when no successful response was observed.
      if ((removed.size || mutationStarted) && !this.closed) await this.connect();
      this.controls();
    }
    if (failure) throw new Error(`${removed.size ? `已删除 ${removed.size} 个对话；其余操作未完成：` : ''}${failure instanceof Error ? failure.message : '删除失败'}`);
    new Notice(replace ? '已清空当前对话并开始新对话' : `已删除 ${removed.size} 个对话（含子对话）`);
  }
  private async compactSession(): Promise<void> {
    if (!this.connected || !this.session || this.submitting || this.active || this.pendingForms) return;
    const id = this.session; const client = this.client;
    this.submitting = true; this.controls();
    try {
      await client.compact(id);
      this.active = true; this.status.setText('正在压缩对话历史…'); this.schedule(300);
      new Notice('已请求压缩历史；聊天记录仍保留，后续上下文由服务器生成摘要');
    } finally { this.submitting = false; this.controls(); }
  }
  private async refresh(): Promise<void> {
    if (this.closed || !this.connected) return;
    if (this.refreshInFlight) { this.schedule(300); return; }
    if (!this.session) { this.status.setText('已连接，点击“新对话”开始'); return; }
    const id = this.session; const epoch = this.epoch;
    this.refreshInFlight = true; this.lastRefresh = Date.now();
    try {
      const [result, active, permissions, forms] = await Promise.all([this.client.messages(id), this.client.active(), this.client.permissions(id), this.client.forms(id)]);
      if (id !== this.session || epoch !== this.epoch || this.closed) return;
      this.error = ''; this.active = id in active;
      // Refresh the newest page without throwing away explicitly loaded history.
      for (const message of result.data) {
        this.messages.set(message.id, message);
        if (message.time?.completed) this.previews.delete(message.id);
      }
      if (this.messageCursor === undefined) this.messageCursor = result.cursor?.next ?? null;
      await this.renderMessages(); this.showPermissions(permissions, id);
      if (id !== this.session || epoch !== this.epoch || this.closed) return;
      this.pendingForms = forms.length; this.forms.update(forms);
      // Titles are generated asynchronously on the server. Refresh just this
      // option rather than rebuilding the dropdown and losing loaded history.
      try {
        const session = await this.client.session(id);
        if (id !== this.session || epoch !== this.epoch || this.closed) return;
        const existing = this.sessions.find(item => item.id === id);
        if (existing) existing.title = session.title;
        const option = Array.from(this.select.options).find(item => item.value === id);
        const title = session.title || '未命名对话';
        if (option && option.textContent !== title) option.textContent = title;
      } catch { /* Title lookup must not interrupt message delivery. */ }
      this.status.setText(forms.length ? 'AI 正在等待你的回答' : permissions.length ? '等待你处理操作请求' : this.active ? (this.streaming ? 'AI 正在回复…' : 'AI 正在回复 · 自动刷新') : '已连接');
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
    const text = this.input.value.trim(); if (!text || this.submitting || this.active || this.pendingForms) return;
    if (!this.connected || !this.plugin.settings.password) { this.plugin.openSettings(); return; }
    const command = commandInput(text);
    if (command?.name === 'compact') {
      if (command.text) throw new Error('/compact 不接受参数');
      if (this.context) throw new Error('压缩历史前请移除附加笔记或选段');
      if (!this.session) throw new Error('请先开始一个对话，再压缩历史');
      await this.compactSession(); this.input.value = ''; if (Platform.isMobile) this.input.style.height = '44px'; return;
    }
    this.submitting = true; this.controls();
    try {
      if (!this.session) await this.newSessionForSend();
      const id = this.session; const context = this.context;
      if (command) {
        if (context) throw new Error('执行命令前请移除附加笔记或选段');
        const commands = await this.client.commands();
        if (!commands.some(item => item.name === command.name)) throw new Error('服务器没有这个命令：/' + command.name);
        await this.client.command(id, command.name, command.text);
      } else {
        const attached = context ? `\n\n附加上下文（用户选中的笔记材料）：\n笔记路径：vault/${context.path}\n${context.selection ? '选中文字：\n' + context.selection : '请按需要读取服务器已同步的这篇笔记。'}` : '';
        await this.client.prompt(id, text + attached);
      }
      this.input.value = ''; if (Platform.isMobile) this.input.style.height = '44px'; this.context = undefined; this.contextEl.empty(); this.active = true; this.status.setText('已发送，AI 正在处理…'); this.schedule(300);
    } finally { this.submitting = false; this.controls(); }
  }
  private async newSessionForSend(): Promise<void> {
    const session = await this.client.create();
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
    const field = (name: string, key: keyof Connection | 'serverVault', description: string, secret = false) => {
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
    this.containerEl.createEl('h2', { text: '一键记录' });
    this.containerEl.createEl('p', { text: '桌面入口直接打开记录框，离线保存到本地 InBox。复制链接后用手机桌面的快捷方式功能配置；冷启动需等待 Obsidian 加载。' });
    new Setting(this.containerEl).setName('桌面链接').addText(text => {
      text.setValue(captureUri(this.app.vault.getName())); text.inputEl.readOnly = true;
    }).addButton(button => button.setButtonText('复制').onClick(() => this.plugin.copyCaptureLink()));
    new Setting(this.containerEl).setName('试用记录框').addButton(button => button.setButtonText('一键记录').onClick(() => this.plugin.openCapture()));
    this.containerEl.createEl('h2', { text: '一键打开 AI 管家' });
    this.containerEl.createEl('p', { text: '复制链接后配置名为“OBSB AI 管家”的桌面快捷方式，点击直接打开当前聊天。冷启动需等待 Obsidian 加载。' });
    new Setting(this.containerEl).setName('桌面链接').addText(text => {
      text.setValue(chatUri(this.app.vault.getName())); text.inputEl.readOnly = true;
    }).addButton(button => button.setButtonText('复制').onClick(() => this.plugin.copyChatLink()));
    new Setting(this.containerEl).setName('试用聊天入口').addButton(button => button.setButtonText('打开 AI 管家').onClick(() => this.plugin.openChatShortcut()));
  }
}
