export interface Session {
  id: string; parentID?: string; title?: string; location?: { directory?: string }; time?: { created?: number; updated?: number };
}
export interface Content {
  type: string; text?: string; name?: string; state?: { status?: string; error?: string };
}
export interface Message {
  id: string; type: string; text?: string; content?: Content[];
  time?: { created?: number; completed?: number }; error?: { message?: string }; finish?: string;
}
export interface Permission { id: string; action: string; resources: string[]; message?: string }
export type FormValue = string | number | boolean | string[];
export type FormAnswer = Record<string, FormValue>;
export interface FormField {
  key: string; type: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
  when?: { key: string; op: 'eq' | 'neq'; value: string | number | boolean }[];
  default?: FormValue; options?: { value: string; label: string; description?: string }[]; custom?: boolean;
  minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string;
  minimum?: number; maximum?: number; format?: string; placeholder?: string; url?: string;
}
export interface SessionForm { id: string; sessionID: string; title: string; fields: FormField[] }
export interface Page<T> { data: T[]; cursor?: { next?: string | null; previous?: string | null } }
export function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) return (value as { data: T }).data;
  return value as T;
}
export function page<T>(value: unknown): Page<T> {
  const data = unwrap<T[]>(value);
  if (!Array.isArray(data)) throw new Error('OpenCode 返回了不支持的数据格式');
  return { data, cursor: (value as Page<T>)?.cursor };
}
export function apiRoot(server: string): string {
  const url = new URL(server.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写服务器 HTTP/HTTPS 地址，账号密码单独填写');
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  return url.toString().replace(/\/$/, '');
}
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return 'Basic ' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}
export function noteTarget(raw: string, serverVault = '/workspace/vault'): string | null {
  let target = raw.trim();
  try { target = decodeURIComponent(target); } catch { return null; }
  target = target.replace(/\\/g, '/');
  if (target.startsWith('[[') && target.endsWith(']]')) target = target.slice(2, -2).split('|')[0];
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
  const root = serverVault.replace(/\\/g, '/').replace(/\/$/, '');
  if (target.startsWith(root + '/')) target = target.slice(root.length + 1);
  target = target.replace(/^\/?vault\//, '').replace(/^\.\//, '');
  const [path, ...anchor] = target.split('#');
  if (!path || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.' || !part)) return null;
  if (/\.[a-z\d]+$/i.test(path) && !path.endsWith('.md')) return null;
  return path.replace(/\.md$/, '') + (anchor.length ? '#' + anchor.join('#') : '');
}
export function messageText(message: Message): string {
  if (message.type === 'user') return message.text ?? '';
  return (message.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n\n');
}
export function chronological(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || a.id.localeCompare(b.id));
}
export function commandInput(text: string): { name: string; text: string } | null {
  const match = text.trim().match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
  return match ? { name: match[1], text: match[2] ?? '' } : null;
}
export interface StreamPreview { id: string; text: string; ordinal: number; created: number }
export function applyTextDelta(previews: Map<string, StreamPreview>, event: unknown, session: string): boolean {
  const value = event as { type?: string; created?: number; data?: { sessionID?: string; assistantMessageID?: string; ordinal?: number; delta?: string } };
  const data = value?.data;
  if (value?.type !== 'session.text.delta' || data?.sessionID !== session || !data.assistantMessageID || typeof data.delta !== 'string') return false;
  let preview = previews.get(data.assistantMessageID);
  if (!preview) { preview = { id: data.assistantMessageID, text: '', ordinal: data.ordinal ?? 0, created: value.created ?? Date.now() }; previews.set(preview.id, preview); }
  if (preview.ordinal !== data.ordinal) { preview.text += '\n\n'; preview.ordinal = data.ordinal ?? 0; }
  preview.text += data.delta;
  return true;
}
export class SseDecoder {
  private buffer = '';
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const events: unknown[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      try { let value = JSON.parse(data); if (typeof value === 'string') value = JSON.parse(value); events.push(value); } catch { /* Ignore non-JSON heartbeats. */ }
    }
    return events;
  }
}
