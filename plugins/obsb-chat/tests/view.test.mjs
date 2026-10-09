import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const { Platform } = await import('../.test-build/main.mjs');
const { Modal, FormCards } = await import('../.test-build/main.mjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function captureSetup(initial = {}, ready = true) {
  const { TFolder, TFile } = await import('../.test-build/main.mjs');
  const nodes = new Map(); const contents = new Map(); const writes = []; const layouts = [];
  const app = { workspace: { onLayoutReady: callback => ready ? callback() : layouts.push(callback) }, vault: {
    getName: () => '我的知识库 & 灵感', getAbstractFileByPath: path => nodes.get(path),
    createFolder: async path => { nodes.set(path, new TFolder(path)); },
    create: async (path, content) => { if (nodes.has(path)) throw new Error('already exists'); nodes.set(path, new TFile(path)); contents.set(path, content); writes.push({ path, content }); },
    read: async file => contents.get(file.path),
  } };
  let stored = structuredClone(initial); const plugin = new Plugin(app);
  plugin.loadData = async () => structuredClone(stored);
  plugin.saveData = async data => { stored = structuredClone(data); };
  plugin.client = () => { throw new Error('Capture must never connect to a server'); };
  await plugin.onload();
  return { plugin, app, nodes, contents, writes, stored: () => stored, ready: () => { ready = true; for (const callback of layouts.splice(0)) callback(); } };
}

test('chat shortcut encodes the vault and coalesces cold and in-flight launches', async () => {
  const { chatUri } = await import('../.test-build/main.mjs');
  const cold = await captureSetup({}, false); let calls = 0; let finish;
  cold.plugin.openChat = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    assert.equal(chatUri('我的知识库 & 灵感'), 'obsidian://obsb-chat?vault=%E6%88%91%E7%9A%84%E7%9F%A5%E8%AF%86%E5%BA%93%20%26%20%E7%81%B5%E6%84%9F');
    const invoke = cold.plugin.protocols.get('obsb-chat');
    invoke({ vault: '其他仓库' }); assert.equal(cold.plugin.chatQueued, false);
    invoke({ vault: '我的知识库 & 灵感' }); invoke({}); assert.equal(calls, 0);
    cold.ready(); assert.equal(calls, 1); invoke({}); assert.equal(calls, 1);
    finish(); await tick(); invoke({}); assert.equal(calls, 2); finish(); await tick();
    assert.equal(cold.writes.length, 0);
  } finally { cold.plugin.onunload(); }
});

test('chat shortcut cancels unloaded launches and permits retry after an opening error', async () => {
  const cold = await captureSetup({}, false); let calls = 0;
  cold.plugin.openChat = async () => { calls++; };
  cold.plugin.openChatShortcut(); cold.plugin.onunload(); cold.ready(); assert.equal(calls, 0);
  const live = await captureSetup();
  live.plugin.openChat = async () => { calls++; throw new Error('open failed'); };
  try {
    live.plugin.openChatShortcut(); await tick(); assert.equal(live.plugin.chatQueued, false);
    live.plugin.openChatShortcut(); await tick(); assert.equal(calls, 2);
  } finally { live.plugin.onunload(); }
});

test('chat shortcut reveals an existing chat without creating a tab or sending a request', async () => {
  const { plugin, app } = await captureSetup(); const leaf = {}; let shown;
  app.workspace.getLeavesOfType = () => [leaf]; app.workspace.revealLeaf = async value => { shown = value; };
  const mobile = Platform.isMobile; Platform.isMobile = false;
  try { plugin.openChatShortcut(); await tick(); assert.equal(shown, leaf); }
  finally { Platform.isMobile = mobile; plugin.onunload(); }
});

test('capture URI targets the encoded vault; cold launch queues once and rejects the wrong vault', async () => {
  const { captureUri } = await import('../.test-build/main.mjs');
  const { plugin, ready, writes } = await captureSetup({}, false);
  try {
    assert.equal(captureUri('我的知识库 & 灵感'), 'obsidian://obsb-capture?vault=%E6%88%91%E7%9A%84%E7%9F%A5%E8%AF%86%E5%BA%93%20%26%20%E7%81%B5%E6%84%9F');
    const invoke = plugin.protocols.get('obsb-capture');
    invoke({ vault: '其他仓库' }); ready(); assert.equal(plugin.captureModal, undefined);
    invoke({ vault: '我的知识库 & 灵感' }); const modal = plugin.captureModal;
    invoke({ vault: '我的知识库 & 灵感' }); assert.equal(plugin.captureModal, modal);
    assert.equal(writes.length, 0); modal.close();
  } finally { plugin.onunload(); }
  const cold = await captureSetup({}, false);
  try {
    cold.plugin.openCapture(); cold.plugin.openCapture(); assert.equal(cold.plugin.captureModal, undefined);
    cold.ready(); assert.ok(cold.plugin.captureModal); cold.plugin.captureModal.close();
  } finally { cold.plugin.onunload(); }
});

test('capture saves literal multiline Markdown to Inbox offline and closes without opening the note', async () => {
  const { plugin, writes, stored } = await captureSetup();
  try {
    plugin.commands.get('quick-capture').callback(); const modal = plugin.captureModal;
    const input = modal.contentEl.querySelector('textarea'); input.value = '  灵感\n[[Raw/笔记]]\nhttps://example.test/a?q=1  ';
    input.dispatchEvent(new window.Event('input'));
    Array.from(modal.contentEl.querySelectorAll('button')).find(button => button.textContent === '保存').click(); await tick(); await tick();
    assert.equal(writes.length, 1); assert.match(writes[0].path, /^InBox\/灵感-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.md$/);
    assert.equal(writes[0].content, '  灵感\n[[Raw/笔记]]\nhttps://example.test/a?q=1  \n');
    assert.equal(stored().capture.draft, ''); assert.equal(plugin.captureModal, undefined);
  } finally { plugin.onunload(); }
});

test('closing a capture persists the draft and restores it after plugin restart; plain Enter does not save', async () => {
  const { plugin, stored, writes } = await captureSetup();
  plugin.openCapture(); const input = plugin.captureModal.contentEl.querySelector('textarea');
  input.value = '还没写完的灵感'; input.dispatchEvent(new window.Event('input'));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); assert.equal(writes.length, 0);
  plugin.captureModal.close(); await plugin.save(); plugin.onunload();
  const restarted = await captureSetup(stored());
  try { restarted.plugin.openCapture(); assert.equal(restarted.plugin.captureModal.contentEl.querySelector('textarea').value, '还没写完的灵感'); }
  finally { restarted.plugin.onunload(); }
});

test('blank capture and file-instead-of-Inbox are rejected without clearing the draft', async () => {
  const { saveCapture, TFile } = await import('../.test-build/main.mjs');
  const { app, nodes, writes } = await captureSetup(); const state = { draft: ' \n ' };
  await assert.rejects(() => saveCapture(app, state, async () => {}), /请先输入/);
  state.draft = '灵感'; nodes.set('InBox', new TFile('InBox'));
  await assert.rejects(() => saveCapture(app, state, async () => {}), /同名文件占用/);
  assert.equal(writes.length, 0); assert.equal(state.draft, '灵感');
});

test('same-time captures choose distinct names and never overwrite an existing note', async () => {
  const { saveCapture } = await import('../.test-build/main.mjs'); const { app, writes } = await captureSetup();
  const now = new Date(2026, 9, 9, 12, 34, 56, 7);
  await saveCapture(app, { draft: '第一条' }, async () => {}, now);
  await saveCapture(app, { draft: '第二条' }, async () => {}, now);
  assert.deepEqual(writes.map(write => write.path), ['InBox/灵感-2026-10-09-123456-007.md', 'InBox/灵感-2026-10-09-123456-007-2.md']);
  assert.deepEqual(writes.map(write => write.content), ['第一条\n', '第二条\n']);
});

test('capture write failure retains input; cleanup failure retries the already-written file exactly once', async () => {
  const { saveCapture } = await import('../.test-build/main.mjs'); const { app, writes } = await captureSetup();
  const state = { draft: '不能丢失' }; const create = app.vault.create;
  app.vault.create = async () => { throw new Error('offline storage'); };
  await assert.rejects(() => saveCapture(app, state, async () => {}), /offline storage/); assert.equal(state.draft, '不能丢失');
  app.vault.create = create; let saves = 0;
  await assert.rejects(() => saveCapture(app, state, async () => { if (++saves === 2) throw new Error('disk error'); }), /笔记已保存.*草稿清理失败/);
  assert.equal(writes.length, 1); assert.equal(state.draft, '不能丢失');
  await saveCapture(app, state, async () => {}); assert.equal(writes.length, 1); assert.equal(state.draft, '');
});

test('repeated save and URI activation while saving cannot create a second capture', async () => {
  const { plugin, app, writes } = await captureSetup(); let release;
  const create = app.vault.create; app.vault.create = async (...args) => { await new Promise(resolve => { release = resolve; }); await create(...args); };
  try {
    plugin.openCapture(); const modal = plugin.captureModal; const input = modal.contentEl.querySelector('textarea'); input.value = '一条灵感';
    const save = Array.from(modal.contentEl.querySelectorAll('button')).find(button => button.textContent === '保存');
    save.dispatchEvent(new window.Event('click')); save.dispatchEvent(new window.Event('click')); await tick();
    modal.close(); plugin.openCapture(); assert.equal(plugin.captureModal, modal); assert.equal(writes.length, 0);
    release(); await tick(); await tick(); assert.equal(writes.length, 1); assert.equal(plugin.captureModal, undefined);
  } finally { plugin.onunload(); }
});

test('settings and capture draft writes are serialized and persist the latest values together', async () => {
  const { plugin } = await captureSetup(); let inFlight = 0; const saved = [];
  plugin.saveData = async data => { assert.equal(inFlight++, 0); await tick(); saved.push(data); inFlight--; };
  plugin.settings.capture.draft = '我的灵感'; const first = plugin.save();
  plugin.settings.serverUrl = 'https://example.test'; const second = plugin.save(); await Promise.all([first, second]);
  assert.equal(saved.at(-1).capture.draft, '我的灵感'); assert.equal(saved.at(-1).serverUrl, 'https://example.test'); plugin.onunload();
});

test('pending forms retain input through polling and submit choices, custom text, false and numbers', async () => {
  const { view, client, sent } = await setup();
  const form = { id: 'frm_one', sessionID: 'ses_one', title: '选择方案', fields: [
    { key: 'single', type: 'string', required: true, options: [{ value: 'a', label: '甲' }], custom: true },
    { key: 'many', type: 'multiselect', required: true, options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }], custom: true },
    { key: 'text', type: 'string', required: true }, { key: 'flag', type: 'boolean', required: true }, { key: 'number', type: 'integer', required: true, minimum: 0 },
  ] };
  let forms = [form]; const replies = [];
  client.forms = async () => forms;
  client.answerForm = async (id, formID, answer) => { replies.push({ id, formID, answer }); forms = []; };
  try {
    await view.refresh();
    assert.equal(view.contentEl.querySelector('.obsb-status').textContent, 'AI 正在等待你的回答');
    const card = view.contentEl.querySelector('.obsb-form-card');
    const fields = card.querySelectorAll('.obsb-form-field');
    fields[0].querySelector('input').click(); fields[0].querySelector('textarea').value = '自定义方案';
    fields[1].querySelectorAll('input')[1].click(); fields[1].querySelector('textarea').value = '额外选项';
    fields[2].querySelector('textarea').value = '理由'; fields[3].querySelector('select').value = 'false'; fields[4].querySelector('input').value = '0';
    await view.refresh(); assert.equal(view.contentEl.querySelector('.obsb-form-card'), card);
    view.contentEl.querySelector('.obsb-composer textarea').value = '不应该发出'; await view.send(); assert.equal(sent.length, 0);
    card.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(replies, [{ id: 'ses_one', formID: 'frm_one', answer: { single: '自定义方案', many: ['b', '额外选项'], text: '理由', flag: false, number: 0 } }]);
    assert.equal(view.contentEl.querySelector('.obsb-form-card'), null);
  } finally { await view.onClose(); view.unload(); }
});

test('form validation, conditions, duplicate submission and failed replies preserve answers', async () => {
  const parent = document.createElement('div'); const calls = []; let fail = true;
  document.body.append(parent);
  const cards = new FormCards(parent, async (_, answer) => { calls.push(answer); if (fail) throw new Error('offline'); });
  const form = { id: 'frm_test', sessionID: 'ses_one', title: '问题', fields: [
    { key: 'choice', type: 'string', required: true, options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }] },
    { key: 'extra', type: 'string', required: true, when: [{ key: 'choice', op: 'eq', value: 'b' }] },
  ] };
  cards.update([form]); const body = parent.querySelector('form');
  const submit = () => body.dispatchEvent(new window.Event('submit', { cancelable: true }));
  submit(); await tick(); assert.equal(calls.length, 0); assert.match(parent.querySelector('.obsb-error').textContent, /请回答/);
  parent.querySelector('input[value="b"]').click();
  assert.equal(parent.querySelectorAll('.obsb-form-field')[1].hidden, false);
  submit(); await tick(); assert.equal(calls.length, 0);
  parent.querySelector('textarea').value = '保留我的输入';
  submit(); submit(); await tick(); assert.equal(calls.length, 1); assert.equal(parent.querySelector('textarea').value, '保留我的输入');
  assert.equal(parent.querySelector('.obsb-error').textContent, 'offline');
  cards.update([form]); assert.equal(parent.querySelector('form'), body);
  parent.querySelector('input[value="a"]').click(); fail = false; submit(); await tick();
  assert.deepEqual(calls[1], { choice: 'a' });
  cards.update([form]); assert.equal(parent.querySelector('form'), null, 'late stale poll must not resurrect a settled form');
  parent.remove();
});

test('cancel form, unsupported fields and switching sessions cannot send an answer to another session', async () => {
  const { view, client } = await setup(); let forms = [{ id: 'frm_one', sessionID: 'ses_one', title: '问题', fields: [{ key: 'text', type: 'string' }] }];
  const cancelled = []; client.forms = async () => forms;
  client.cancelForm = async (...args) => { cancelled.push(args); forms = []; };
  try {
    await view.refresh();
    Array.from(view.contentEl.querySelectorAll('.obsb-forms button')).find(button => button.textContent === '取消提问').click(); await tick();
    assert.deepEqual(cancelled, [['ses_one', 'frm_one']]);
    forms = [{ id: 'frm_unknown', sessionID: 'ses_one', title: '外部字段', fields: [{ key: 'external', type: 'external' }] }]; await view.refresh();
    assert.equal(view.contentEl.querySelector('.obsb-forms button[type=submit]').disabled, true);
    view.contentEl.querySelector('.obsb-forms form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    assert.match(view.contentEl.querySelector('.obsb-forms .obsb-error[role=alert]').textContent, /暂不支持/);
    await view.choose(''); assert.equal(view.contentEl.querySelector('.obsb-form-card'), null);
  } finally { await view.onClose(); view.unload(); }
});

test('/compact and compression button call compaction API and preserve drafts on failure', async () => {
  const { view, client, sent } = await setup(); const compacted = [];
  client.compact = async id => { compacted.push(id); };
  try {
    const input = view.contentEl.querySelector('.obsb-composer textarea');
    assert.ok(Array.from(view.contentEl.querySelector('.obsb-actions select').options).some(option => option.value === 'compact'));
    input.value = '/compact'; await view.send(); assert.deepEqual(compacted, ['ses_one']); assert.equal(sent.length, 0); assert.equal(input.value, '');
    await view.refresh(); client.compact = async () => { throw new Error('offline'); };
    input.value = '/compact'; await assert.rejects(() => view.send(), /offline/); assert.equal(input.value, '/compact');
    input.value = '/compact extra'; await assert.rejects(() => view.send(), /不接受参数/);
    input.value = '/compact'; view.attach({ path: 'Raw/笔记.md' }); await assert.rejects(() => view.send(), /移除附加/);
  } finally { await view.onClose(); view.unload(); }
});

test('session deletion requires confirmation; active children and other projects are protected', async () => {
  const { view, client, sessions } = await setup(); const removed = [];
  client.remove = async id => { removed.push(id); sessions.splice(sessions.findIndex(item => item.id === id), 1); };
  try {
    view.confirmClear(); assert.equal(removed.length, 0); const confirm = Modal.opened.at(-1);
    assert.match(confirm.contentEl.textContent, /子对话/); confirm.close(); assert.equal(removed.length, 0);
    await assert.rejects(() => view.deleteSessions([{ id: 'ses_other', location: { directory: '/other' } }]), /当前项目/);
    sessions.push({ id: 'ses_child', parentID: 'ses_one', location: { directory: '/workspace' } });
    client.active = async () => ({ ses_child: {} });
    await assert.rejects(() => view.deleteSessions([sessions[0]]), /子对话正在运行/); assert.deepEqual(removed, []);
  } finally { for (const modal of [...Modal.opened]) modal.close(); await view.onClose(); view.unload(); }
});

test('clear deletes the current session and starts an empty server session; batch failures reconcile successes', async () => {
  const { view, client, sessions } = await setup(); const removed = [];
  client.remove = async id => { removed.push(id); sessions.splice(sessions.findIndex(item => item.id === id), 1); };
  client.create = async () => { const session = { id: 'ses_new', title: '新对话', location: { directory: '/workspace' } }; sessions.unshift(session); return session; };
  try {
    await view.deleteSessions([sessions[0]], true); assert.deepEqual(removed, ['ses_one']); assert.equal(view.session, 'ses_new');
    sessions.push({ id: 'ses_fail', location: { directory: '/workspace' } });
    client.remove = async id => { if (id === 'ses_fail') throw new Error('offline'); removed.push(id); sessions.splice(sessions.findIndex(item => item.id === id), 1); };
    await assert.rejects(() => view.deleteSessions([...sessions]), /已删除 1 个对话.*offline/);
    assert.equal(view.session, 'ses_fail'); assert.equal(view.submitting, false); assert.equal(sessions.length, 1);
  } finally { await view.onClose(); view.unload(); }
});

test('manager loads all pages before select-all and confirms exact targets', async () => {
  const { view, client, sessions } = await setup(); const deleted = [];
  sessions.push({ id: 'ses_older', title: '旧对话', location: { directory: '/workspace' } });
  view.deleteSessions = async targets => { deleted.push(targets.map(item => item.id)); };
  try {
    view.manageSessions(); await tick(); const manager = Modal.opened.at(-1);
    const buttons = () => Array.from(manager.contentEl.querySelectorAll('button'));
    buttons().find(button => button.textContent === '全选当前项目').click();
    buttons().find(button => button.textContent.startsWith('删除选中')).click();
    assert.equal(deleted.length, 0); const confirm = Modal.opened.at(-1);
    assert.match(confirm.contentEl.textContent, /测试/); assert.match(confirm.contentEl.textContent, /旧对话/);
    Array.from(confirm.contentEl.querySelectorAll('button')).find(button => button.textContent === '确认删除').click(); await tick();
    assert.deepEqual(deleted, [['ses_one', 'ses_older']]);
  } finally { for (const modal of [...Modal.opened]) modal.close(); await view.onClose(); view.unload(); }
});

test('manager stays usable after deletion rebuilds the client with the same connection', async () => {
  const { view, plugin, client, sessions } = await setup(); const removed = [];
  sessions.push({ id: 'ses_older', title: '旧对话', location: { directory: '/workspace' } });
  client.remove = async id => { removed.push(id); sessions.splice(sessions.findIndex(item => item.id === id), 1); };
  plugin.client = () => ({ ...client, connection: { ...client.connection } });
  try {
    view.manageSessions(); await tick(); const manager = Modal.opened.at(-1);
    for (const title of ['旧对话', '测试']) {
      Array.from(manager.contentEl.querySelectorAll('.obsb-session-row')).find(row => row.textContent === title).querySelector('input').click();
      Array.from(manager.contentEl.querySelectorAll('button')).find(button => button.textContent.startsWith('删除选中')).click();
      const confirm = Modal.opened.at(-1);
      Array.from(confirm.contentEl.querySelectorAll('button')).find(button => button.textContent === '确认删除').click();
      await tick(); await tick(); assert.equal(Modal.opened.includes(confirm), false);
    }
    assert.deepEqual(removed, ['ses_older', 'ses_one']); assert.equal(view.session, '');
  } finally { for (const modal of [...Modal.opened]) modal.close(); await view.onClose(); view.unload(); }
});

test('a lost deletion response reconciles server state instead of leaving a deleted conversation selected', async () => {
  const { view, client, sessions } = await setup();
  client.remove = async () => { sessions.splice(0); throw new Error('response lost'); };
  try {
    await assert.rejects(() => view.deleteSessions([...sessions]), /response lost/);
    assert.equal(view.session, ''); assert.equal(view.contentEl.querySelectorAll('.obsb-message').length, 0);
    assert.equal(view.submitting, false);
  } finally { await view.onClose(); view.unload(); }
});

test('a detached form after switching conversations cannot submit against the new selection', async () => {
  const { view, client } = await setup(); const replies = [];
  client.forms = async () => [{ id: 'frm_one', sessionID: 'ses_one', title: '回答', fields: [{ key: 'answer', type: 'string', required: true }] }];
  client.answerForm = async (...args) => replies.push(args);
  try {
    await view.refresh(); const form = view.contentEl.querySelector('.obsb-form-card form'); form.querySelector('textarea').value = '旧答案';
    await view.choose('');
    form.dispatchEvent(new window.Event('submit', { cancelable: true })); await tick();
    assert.deepEqual(replies, []); assert.match(form.querySelector('.obsb-error').textContent, /对话已切换/);
  } finally { await view.onClose(); view.unload(); }
});

test('mobile opens a main tab and replaces a restored sidebar; desktop keeps its sidebar', async () => {
  for (const mobile of [true, false]) {
    Platform.isMobile = mobile;
    const calls = []; const root = {};
    const existing = { getRoot: () => ({}), detach: () => calls.push('detach') };
    const created = { setViewState: async () => calls.push('view'), view: {} };
    const app = { workspace: { rootSplit: root, getLeavesOfType: () => [existing], getLeaf: type => { calls.push(type); return created; }, getRightLeaf: () => { calls.push('right'); return created; }, revealLeaf: async leaf => calls.push(leaf === created ? 'main' : 'existing') } };
    try { await new Plugin(app).openChat(); assert.deepEqual(calls, mobile ? ['detach', 'tab', 'view', 'main'] : ['existing']); }
    finally { Platform.isMobile = false; }
  }
});

test('mobile extras start collapsed and composer grows only to 104px; desktop extras remain visible', async () => {
  Platform.isMobile = true;
  const { view } = await setup();
  try {
    const extras = view.contentEl.querySelector('details');
    assert.equal(extras.open, false);
    extras.open = true;
    assert.ok(extras.querySelector('select[aria-label="OpenCode 命令"]'));
    const input = view.contentEl.querySelector('textarea');
    Object.defineProperty(input, 'scrollHeight', { value: 500 });
    input.dispatchEvent(new window.Event('input'));
    assert.equal(input.style.height, '104px');
    input.value = '测试'; await view.send();
    assert.equal(input.style.height, '44px');
  } finally { await view.onClose(); view.unload(); Platform.isMobile = false; }
  const desktop = await setup();
  try { assert.equal(desktop.view.contentEl.querySelector('details').open, true); }
  finally { await desktop.view.onClose(); desktop.view.unload(); }
});
async function setup() {
  const opened = []; const sent = []; let network = true;
  const app = { workspace: { openLinkText: async (...args) => { opened.push(args); }, getActiveFile: () => null }, metadataCache: { getFirstLinkpathDest: path => path === 'Raw/笔记' ? file : null } };
  const plugin = new Plugin(app); await plugin.onload();
  const view = plugin.factory({ app });
  const { createMockFile } = await import('../.test-build/main.mjs');
  const file = createMockFile('Raw/笔记.md');
  const messages = [{ id: 'msg_one', type: 'assistant', time: { created: 1, completed: 2 }, content: [{ type: 'text', text: '[[Raw/笔记#标题|引用]] `vault/Raw/笔记.md#^block` [[Raw/不存在]]' }] }];
  plugin.settings.password = 'test';
  plugin.settings.serverUrl = 'https://example.test';
  const sessions = [{ id: 'ses_one', title: '测试', location: { directory: '/workspace' } }];
  const client = { connection: { directory: '/workspace' }, info: async () => ({ version: '2.0.7' }), sessions: async () => ({ data: sessions }), allSessions: async () => sessions, session: async id => sessions.find(item => item.id === id), forms: async () => [], commands: async () => [{ name: 'run-nightly' }], messages: async () => { if (!network) throw new Error('offline'); return { data: messages }; }, active: async () => ({}), permissions: async () => [], subscribe: async () => { throw new Error('CORS'); }, prompt: async (id, text) => { sent.push({ id, text }); }, command: async (id, name, text) => { sent.push({ id, name, text }); } };
  plugin.client = () => client;
  await view.onOpen();
  return { view, plugin, opened, sent, messages, sessions, client, offline: () => { network = false; }, online: () => { network = true; } };
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

test('refresh updates server-generated title without losing dropdown history or selection', async () => {
  const { view } = await setup();
  try {
    const select = view.contentEl.querySelector('.obsb-session-bar select');
    select.createEl('option', { text: '更早会话', value: 'ses_older' });
    view.client.session = async () => ({ id: 'ses_one', title: '宝宝饮食记录' });
    await view.refresh();
    assert.equal(select.selectedOptions[0].textContent, '宝宝饮食记录');
    assert.equal(select.value, 'ses_one');
    assert.ok(Array.from(select.options).some(item => item.value === 'ses_older'));
    view.client.session = async () => { throw new Error('title unavailable'); };
    await view.refresh();
    assert.equal(view.contentEl.querySelector('.obsb-status').textContent, '已连接');
  } finally { await view.onClose(); view.unload(); }
});

test('new sessions never send a fixed timestamp title', async () => {
  const { view } = await setup();
  const calls = [];
  view.client.create = async (...args) => { calls.push(args); return { id: 'ses_one' }; };
  try {
    await view.newSession(); await view.newSessionForSend();
    assert.deepEqual(calls, [[], []]);
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

test('file changes render server patches literally with counts, line numbers and stable folding', async () => {
  const { view, messages } = await setup();
  messages[0].content.push({ type: 'tool', name: 'edit', state: { status: 'completed', metadata: { files: [
    { file: 'vault/Raw/笔记.md', additions: 1, deletions: 1, patch: 'Index: vault/Raw/笔记.md\n--- old\n+++ new\n@@ -28,2 +28,2 @@\n 保留\n-原文\n+<img src=x onerror=alert(1)>' },
  ] } } });
  try {
    await view.refresh();
    const card = view.contentEl.querySelector('.obsb-change');
    assert.equal(card.open, true);
    assert.match(card.querySelector('summary').textContent, /vault\/Raw\/笔记.md\+1−1/);
    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('.obsb-diff-add .obsb-diff-text').textContent, '+<img src=x onerror=alert(1)>');
    assert.deepEqual([...card.querySelector('.obsb-diff-delete').querySelectorAll('.obsb-diff-number')].map(el => el.textContent), ['29', '']);
    assert.deepEqual([...card.querySelector('.obsb-diff-add').querySelectorAll('.obsb-diff-number')].map(el => el.textContent), ['', '29']);
    card.open = false; await view.refresh();
    assert.equal(view.contentEl.querySelector('.obsb-change'), card); assert.equal(card.open, false);
  } finally { await view.onClose(); view.unload(); }
});

test('file records handle multiple files, absent patches, errors and server truncation', async () => {
  const { view, messages } = await setup();
  messages[0].content.push(
    { type: 'tool', name: 'apply_patch', state: { status: 'completed', metadata: { truncated: true, files: [
      { file: 'vault/Raw/新增.md', patch: '@@ -0,0 +1 @@\n+新增', additions: 1, deletions: 0 },
      { file: 'vault/Raw/删除.md', status: 'deleted', additions: 0, deletions: 2 },
    ] } } },
    { type: 'tool', name: 'edit', state: { status: 'error', metadata: { files: [{ file: '失败.md', patch: '+失败' }] } } },
    { type: 'tool', name: 'read', state: { status: 'completed' } },
  );
  try {
    await view.refresh();
    assert.equal(view.contentEl.querySelectorAll('.obsb-change').length, 2);
    assert.match(view.contentEl.textContent, /服务器未提供逐行差异/);
    assert.match(view.contentEl.textContent, /服务器返回的修改记录已截断/);
    assert.equal(view.contentEl.querySelector('.obsb-diff-add .obsb-diff-number:nth-child(2)').textContent, '1');
  } finally { await view.onClose(); view.unload(); }
});

test('long patches are folded and bounded; streaming text retains tool change records', async () => {
  const { view, messages } = await setup();
  messages[0].content.push({ type: 'tool', name: 'write', state: { status: 'completed', metadata: { files: [
    { file: 'vault/Raw/长文.md', patch: '@@ -0,0 +1,600 @@\n' + Array.from({ length: 600 }, (_, i) => '+' + i).join('\n'), additions: 600, deletions: 0 },
  ] } } });
  view.previews.set('msg_one', { id: 'msg_one', text: '更长的流式回答'.repeat(30), ordinal: 0, created: 1 });
  try {
    await view.renderMessages();
    const card = view.contentEl.querySelector('.obsb-change');
    assert.ok(card); assert.equal(card.open, false);
    assert.equal(card.querySelectorAll('.obsb-diff-line').length, 500);
    assert.match(card.textContent, /仅显示前 500 行/);
  } finally { await view.onClose(); view.unload(); }
});

test('mobile composer clears floating navbar and keyboard without double-counting existing space', async () => {
  const { avoidMobileOverlays } = await import('../.test-build/main.mjs');
  const root = document.createElement('div'); document.body.append(root);
  const nav = document.createElement('div'); nav.className = 'mobile-navbar'; nav.style.opacity = '1'; document.body.append(nav);
  const originalRaf = window.requestAnimationFrame; const originalCancel = window.cancelAnimationFrame;
  const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const callbacks = new Map(); let serial = 0;
  window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  const viewport = new window.EventTarget(); viewport.height = 800; viewport.offsetTop = 0;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  let viewBottom = 800; let navTop = 720;
  root.getBoundingClientRect = () => ({ top: 100, bottom: viewBottom, left: 0, right: 400, width: 400, height: viewBottom - 100 });
  nav.getBoundingClientRect = () => ({ top: navTop, bottom: navTop + 60, left: 30, right: 370, width: 340, height: 60 });
  const flush = async () => { await tick(); for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); } };
  const space = () => root.style.getPropertyValue('--obsb-bottom-obstruction');
  const dispose = avoidMobileOverlays(root);
  try {
    assert.equal(space(), '80px');
    nav.style.display = 'none'; await flush(); assert.equal(space(), '0px');
    nav.style.display = ''; await flush(); assert.equal(space(), '80px');
    viewBottom = 700; window.dispatchEvent(new window.Event('resize')); await flush(); assert.equal(space(), '0px');
    viewBottom = 800; viewport.height = 480; viewport.dispatchEvent(new window.Event('resize')); await flush(); assert.equal(space(), '320px');
    // Navbar repositions above the keyboard; reserve the larger combined overlap.
    navTop = 410; window.dispatchEvent(new window.Event('resize')); await flush(); assert.equal(space(), '390px');
    viewBottom = 480; window.dispatchEvent(new window.Event('resize')); await flush(); assert.equal(space(), '70px');
    nav.style.visibility = 'hidden'; await flush(); assert.equal(space(), '0px');
    viewport.height = 800; viewBottom = 800; nav.style.visibility = ''; navTop = 720; await flush(); assert.equal(space(), '80px');
    window.dispatchEvent(new window.Event('resize')); dispose(); await flush(); assert.equal(space(), '');
    nav.style.display = 'none'; window.dispatchEvent(new window.Event('resize')); viewport.dispatchEvent(new window.Event('scroll')); await flush();
    assert.equal(space(), ''); assert.equal(callbacks.size, 0);
  } finally {
    dispose(); root.remove(); nav.remove(); window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport); else delete window.visualViewport;
  }
});

test('mobile navbar hide rule applies only to the active chat leaf and restores on switching views', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = css.match(/(body\.is-mobile:has\([^\n]+\) \.mobile-navbar)\s*\{([^}]+)\}/);
  assert.ok(rule); assert.match(rule[2], /display:\s*none\s*!important/);
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div class="workspace-leaf mod-active"><div class="workspace-leaf-content" data-type="obsb-chat"></div></div><div class="mobile-navbar"></div>';
  document.body.append(fixture);
  const leaf = fixture.querySelector('.workspace-leaf'); const content = fixture.querySelector('.workspace-leaf-content');
  const matches = () => [...document.querySelectorAll(rule[1])].includes(fixture.querySelector('.mobile-navbar'));
  try {
    document.body.classList.add('is-mobile'); assert.equal(matches(), true);
    content.dataset.type = 'markdown'; assert.equal(matches(), false);
    content.dataset.type = 'obsb-chat'; leaf.classList.remove('mod-active'); assert.equal(matches(), false);
    leaf.classList.add('mod-active'); assert.equal(matches(), true);
    document.body.classList.remove('is-mobile'); assert.equal(matches(), false);
  } finally { fixture.remove(); document.body.classList.remove('is-mobile'); }
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
