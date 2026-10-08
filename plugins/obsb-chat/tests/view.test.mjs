import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
const proto = dom.window.HTMLElement.prototype;
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (name) { this.classList.add(name); };
proto.setText = function (text) { this.textContent = text; };
proto.createEl = function (tag, options = {}) {
  const el = document.createElement(tag);
  if (typeof options === 'string') options = { cls: options };
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  if (options.value !== undefined) el.value = options.value;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.append(el); return el;
};
proto.createDiv = function (options) { return this.createEl('div', options); };
proto.createSpan = function (options) { return this.createEl('span', options); };
const { default: Plugin } = await import('../.test-build/main.mjs');
async function setup() {
  const opened = []; const sent = []; let network = true;
  const app = { workspace: { openLinkText: async (...args) => { opened.push(args); }, getActiveFile: () => null }, metadataCache: { getFirstLinkpathDest: path => path === 'Raw/笔记' ? file : null } };
  const plugin = new Plugin(app); await plugin.onload();
  const view = plugin.factory({ app });
  const { createMockFile } = await import('../.test-build/main.mjs');
  const file = createMockFile('Raw/笔记.md');
  const messages = [{ id: 'msg_one', type: 'assistant', time: { created: 1, completed: 2 }, content: [{ type: 'text', text: '[[Raw/笔记#标题|引用]] `vault/Raw/笔记.md#^block` [[Raw/不存在]]' }] }];
  plugin.settings.password = 'test';
  plugin.client = () => ({ info: async () => ({ version: '2.0.7' }), sessions: async () => ({ data: [{ id: 'ses_one', title: '测试', location: { directory: '/workspace' } }] }), commands: async () => [{ name: 'run-nightly' }], messages: async () => { if (!network) throw new Error('offline'); return { data: messages }; }, active: async () => ({}), permissions: async () => [], subscribe: async () => { throw new Error('CORS'); }, prompt: async (id, text) => { sent.push({ id, text }); }, command: async (id, name, text) => { sent.push({ id, name, text }); } });
  await view.onOpen();
  return { view, plugin, opened, sent, messages, offline: () => { network = false; }, online: () => { network = true; } };
}
test('native view: wikilink heading and server-path block clicks invoke Obsidian navigation', async () => {
  const { view, opened } = await setup();
  try {
    const links = view.contentEl.querySelectorAll('.obsb-body a');
    links[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    links[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(opened.map(x => x[0]), ['Raw/笔记#标题', 'Raw/笔记#^block']);
    assert.equal(opened.every(x => x[2] === true), true);
  } finally { await view.onClose(); view.unload(); }
});
test('missing local note never creates a file; repeated refresh does not duplicate messages', async () => {
  const { view, opened } = await setup();
  try {
    view.contentEl.querySelectorAll('.obsb-body a')[2].click();
    assert.equal(opened.length, 0);
    await view.refresh(); await view.refresh();
    assert.equal(view.contentEl.querySelectorAll('.obsb-message').length, 1);
  } finally { await view.onClose(); view.unload(); }
});
test('commands use command API and failed sends retain the user draft', async () => {
  const { view, sent } = await setup();
  try {
    const input = view.contentEl.querySelector('textarea');
    input.value = '/run-nightly'; await view.send();
    assert.deepEqual(sent[0], { id: 'ses_one', name: 'run-nightly', text: '' });
    await view.refresh(); input.value = '/unknown';
    await assert.rejects(() => view.send(), /没有这个命令/);
    assert.equal(input.value, '/unknown');
  } finally { await view.onClose(); view.unload(); }
});
test('polling fallback recovers after network failure and closes without leaving timers', async () => {
  const { view, offline, online } = await setup();
  offline(); await view.refresh(); assert.equal(view.contentEl.querySelector('.obsb-status').textContent, 'offline');
  online(); await view.refresh(); assert.equal(view.contentEl.querySelector('.obsb-status').textContent, '已连接');
  await view.onClose(); view.unload();
});
test('sidebar context uses the last Markdown editor and sends selection with vault-relative path', async () => {
  const { view, plugin, sent } = await setup();
  try {
    plugin.app.workspace.activeEditor = { file: { path: 'Raw/笔记.md', extension: 'md' }, editor: { getSelection: () => '选中的材料' } };
    assert.equal(plugin.currentNote().selection, '选中的材料');
    view.attach({ path: 'Raw/笔记.md', selection: '选中的材料' });
    view.contentEl.querySelector('textarea').value = '解释这段'; await view.send();
    assert.equal(sent[0].text.includes('vault/Raw/笔记.md'), true);
    assert.equal(sent[0].text.includes('选中的材料'), true);
  } finally { await view.onClose(); view.unload(); }
});

test('Enter, Ctrl+Enter and Cmd+Enter send; Shift+Enter preserves newline', async () => {
  const { view, sent } = await setup();
  const input = view.contentEl.querySelector('textarea');
  const press = options => {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event); return event;
  };
  try {
    input.value = '要换行'; assert.equal(press({ shiftKey: true }).defaultPrevented, false);
    assert.equal(sent.length, 0); assert.equal(input.value, '要换行');
    for (const options of [{}, { ctrlKey: true }, { metaKey: true }]) {
      input.value = '快捷键发送'; assert.equal(press(options).defaultPrevented, true);
      await new Promise(resolve => setTimeout(resolve, 0));
      await view.refresh();
    }
    assert.equal(sent.length, 3); assert.equal(input.value, '');
  } finally { await view.onClose(); view.unload(); }
});

test('IME confirmation Enter never sends, including legacy mobile events', async () => {
  const { view, sent } = await setup();
  const input = view.contentEl.querySelector('textarea'); input.value = '中文选词';
  const press = options => {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...options });
    input.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  };
  try {
    press({ isComposing: true }); press({ keyCode: 229 });
    input.dispatchEvent(new window.CompositionEvent('compositionstart')); press({});
    input.dispatchEvent(new window.CompositionEvent('compositionend'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(sent.length, 0); assert.equal(input.value, '中文选词');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(sent.length, 1);
  } finally { await view.onClose(); view.unload(); }
});

test('unchanged refresh preserves selected text and message nodes', async () => {
  const { view } = await setup();
  document.body.appendChild(view.contentEl);
  const body = view.contentEl.querySelector('.obsb-body');
  const range = document.createRange(); range.selectNodeContents(body);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const selected = selection.toString(); assert.ok(selected);
  try {
    await view.refresh(); await view.refresh();
    assert.equal(view.contentEl.querySelector('.obsb-body'), body);
    assert.equal(selection.toString(), selected);
  } finally { selection.removeAllRanges(); await view.onClose(); view.unload(); view.contentEl.remove(); }
});

test('copy button copies original Markdown without tool status or reasoning', async () => {
  const { view, messages } = await setup();
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied.push(text); } } });
  try {
    messages[0].content.push({ type: 'reasoning', text: '不复制的思考' }, { type: 'tool', name: 'read', state: { status: 'completed' } });
    await view.refresh();
    view.contentEl.querySelector('.obsb-copy').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(copied, [messages[0].content[0].text]);
  } finally { delete window.navigator.clipboard; await view.onClose(); view.unload(); }
});

test('clipboard fallback reports failure and restores selection and focus', async () => {
  const { copyMessage } = await import('../.test-build/main.mjs');
  const input = document.createElement('input'); document.body.appendChild(input); input.focus();
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
  document.execCommand = command => { assert.equal(command, 'copy'); assert.equal(document.querySelector('textarea').value, '完整回答'); return true; };
  try {
    await copyMessage('完整回答', document);
    assert.equal(document.activeElement, input); assert.equal(document.querySelector('textarea'), null);
    document.execCommand = () => false;
    await assert.rejects(() => copyMessage('完整回答', document), /复制失败/);
    assert.equal(document.querySelector('textarea'), null);
  } finally { delete window.navigator.clipboard; delete document.execCommand; input.remove(); }
});
