import { apiRoot, basicAuth, page, SseDecoder, unwrap, type Session, type Message, type Page, type Permission } from './protocol';
export interface Connection { serverUrl: string; username: string; password: string; directory: string }
export interface Response { status: number; text: string }
export type Transport = (url: string, method: string, headers: Record<string, string>, body?: string) => Promise<Response>;
export class OpenCodeClient {
  readonly root: string;
  readonly headers: Record<string, string>;
  constructor(readonly connection: Connection, private transport: Transport) {
    this.root = apiRoot(connection.serverUrl);
    this.headers = { Accept: 'application/json', Authorization: basicAuth(connection.username, connection.password) };
  }
  url(path: string): string { return this.root + path; }
  async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const headers = { ...this.headers, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) };
    const response = await this.transport(this.url(path), method, headers, payload === undefined ? undefined : JSON.stringify(payload));
    if (response.status === 401 || response.status === 403) throw new Error('OpenCode 登录失败，请检查账号和密码');
    if (response.status < 200 || response.status >= 300) throw new Error(`OpenCode 请求失败（HTTP ${response.status}）`);
    if (!response.text) return undefined as T;
    try { return JSON.parse(response.text) as T; } catch { throw new Error('服务器未返回 JSON，请检查地址和反向代理'); }
  }
  async info(): Promise<{ version: string }> { return this.request('GET', '/info'); }
  async sessions(cursor?: string): Promise<Page<Session>> {
    const query = new URLSearchParams({ directory: this.connection.directory, limit: '50' });
    if (cursor) query.set('cursor', cursor); else query.set('order', 'desc');
    const result = page<Session>(await this.request('GET', '/session?' + query));
    result.data = result.data.filter(session => session.location?.directory === this.connection.directory);
    return result;
  }
  async create(title?: string): Promise<Session> {
    return unwrap(await this.request('POST', '/session', { ...(title === undefined ? {} : { title }), location: { directory: this.connection.directory } }));
  }
  async session(id: string): Promise<Session> { return unwrap(await this.request('GET', `/session/${encodeURIComponent(id)}`)); }
  async messages(id: string, cursor?: string): Promise<Page<Message>> {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor); else query.set('order', 'desc');
    return page(await this.request('GET', `/session/${encodeURIComponent(id)}/message?${query}`));
  }
  async active(): Promise<Record<string, unknown>> { return unwrap(await this.request('GET', '/session/active')); }
  async permissions(id: string): Promise<Permission[]> { return unwrap(await this.request('GET', `/session/${encodeURIComponent(id)}/permission`)); }
  async reply(id: string, permission: string, decision: string): Promise<void> {
    await this.request('POST', `/session/${encodeURIComponent(id)}/permission/${encodeURIComponent(permission)}/reply`, { decision });
  }
  async prompt(id: string, text: string): Promise<void> { await this.request('POST', `/session/${encodeURIComponent(id)}/prompt`, { text, resume: true }); }
  async commands(): Promise<{ name: string; description?: string }[]> {
    return unwrap(await this.request('GET', '/command?' + new URLSearchParams({ 'location[directory]': this.connection.directory })));
  }
  async command(id: string, name: string, text: string): Promise<void> { await this.request('POST', `/session/${encodeURIComponent(id)}/command`, { name, text }); }
  async interrupt(id: string): Promise<void> { await this.request('POST', `/session/${encodeURIComponent(id)}/interrupt`); }
  async subscribe(signal: AbortSignal, onEvent: (event: unknown) => void, onConnected: () => void): Promise<void> {
    const response = await fetch(this.url('/event'), { headers: { ...this.headers, Accept: 'text/event-stream' }, signal });
    if (!response.ok || !response.body?.getReader) throw new Error('流式连接不可用');
    onConnected();
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); const sse = new SseDecoder();
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read(); if (done) break;
        for (const event of sse.push(decoder.decode(value, { stream: true }))) onEvent(event);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!signal.aborted) throw new Error('流式连接已断开');
  }
}
