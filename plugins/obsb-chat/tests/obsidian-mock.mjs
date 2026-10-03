// Model only Obsidian API boundaries; tests exercise real ChatView lifecycle and events.
export class Component {
  children = new Set(); cleanups = [];
  addChild(child) { this.children.add(child); return child; }
  removeChild(child) { child.unload(); this.children.delete(child); }
  registerDomEvent(el, name, handler, options) { el.addEventListener(name, handler, options); this.cleanups.push(() => el.removeEventListener(name, handler, options)); }
  unload() { for (const child of this.children) child.unload(); for (const cleanup of this.cleanups) cleanup(); }
}
export class Plugin extends Component {
  constructor(app) { super(); this.app = app; this.manifest = { id: 'obsb-chat' }; }
  async loadData() { return {}; } async saveData() {}
  registerView(type, factory) { this.factory = factory; }
  addSettingTab() {} addRibbonIcon() {} addCommand() {}
}
export class ItemView extends Component {
  constructor(leaf) { super(); this.app = leaf.app; this.contentEl = document.createElement('div'); }
}
export class PluginSettingTab {}
export class Setting {}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
export class Notice { static messages = []; constructor(message) { Notice.messages.push(message); } }
export const MarkdownRenderer = { async render(app, markdown, el) {
  // Native renderer is supplied by Obsidian in production. The test deliberately
  // checks the plugin's navigation handler, not a reimplementation of Markdown.
  for (const item of markdown.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`/g)) {
    if (item[3]) { const code = document.createElement('code'); code.textContent = item[3]; el.append(code); }
    else { const link = document.createElement('a'); link.className = 'internal-link'; link.dataset.href = item[1]; link.textContent = item[2] ?? item[1]; el.append(link); }
  }
  if (!el.childNodes.length) el.textContent = markdown;
} };
export async function requestUrl() { throw new Error('Tests must inject a transport'); }
