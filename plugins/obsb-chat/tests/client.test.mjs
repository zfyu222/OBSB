import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTextDelta, apiRoot, basicAuth, noteTarget, SseDecoder, chronological, messageText, commandInput } from '../.test-build/protocol.mjs';
import { OpenCodeClient } from '../.test-build/client.mjs';
const connection = { serverUrl: 'https://example.test:40087/', username: 'opencode', password: '中文口令', directory: '/workspace' };
test('normalizes API URLs and supports Unicode credentials without leaking them into URLs', () => {
  assert.equal(apiRoot('https://example.test:40087/api/'), 'https://example.test:40087/api');
  assert.equal(Buffer.from(basicAuth('opencode', '中文口令').slice(6), 'base64').toString(), 'opencode:中文口令');
  assert.throws(() => apiRoot('https://user:password@example.test'));
});
test('maps vault-relative, server, Windows-style paths and heading/block targets', () => {
  for (const [source, expected] of [
    ['[[Raw/项目/笔记#标题|引用]]', 'Raw/项目/笔记#标题'],
    ['/workspace/vault/Raw/笔记.md#^abc', 'Raw/笔记#^abc'],
    ['vault\\Raw\\笔记.md', 'Raw/笔记'],
    ['Raw/%E7%AC%94%E8%AE%B0.md', 'Raw/笔记'],
    ['/custom/vault/InBox/笔记.md', 'InBox/笔记'],
  ]) assert.equal(noteTarget(source, '/custom/vault'), source.startsWith('/workspace') ? null : expected);
  assert.equal(noteTarget('/workspace/vault/Raw/笔记.md#^abc'), 'Raw/笔记#^abc');
});
test('never opens outside-vault, traversal, malformed links or binary attachments', () => {
  for (const value of ['../secrets/a.md', '/etc/passwd', 'Raw/%2E%2E/secrets/a.md', 'Assets/a.png', 'https://example.test/a.md', 'javascript:alert(1)', 'Raw/%E0%A4%A']) assert.equal(noteTarget(value), null);
});
test('reads deployed v2 user text and assistant content, excluding reasoning', () => {
  assert.equal(messageText({ type: 'user', text: '问题' }), '问题');
  assert.equal(messageText({ type: 'assistant', content: [{ type: 'reasoning', text: '不展示' }, { type: 'text', text: '[[Raw/笔记]]' }, { type: 'tool', name: 'read' }] }), '[[Raw/笔记]]');
  assert.deepEqual(chronological([{ id: 'b', time: { created: 2 } }, { id: 'a', time: { created: 1 } }]).map(x => x.id), ['a', 'b']);
});
test('SSE decodes split CRLF, multiple frames, multiline and JSON-encoded v2 events', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push('data: {"type":"message.updated"}\r'), []);
  assert.deepEqual(decoder.push('\n\r\ndata: "{\\"type\\":\\"session.idle\\"}"\n\n'), [{ type: 'message.updated' }, { type: 'session.idle' }]);
  assert.deepEqual(decoder.push(': heartbeat\n\ndata: {\ndata: "type":"connected"}\n\n'), [{ type: 'connected' }]);
});
test('commands are separate from ordinary prompts and preserve arguments', () => {
  assert.deepEqual(commandInput('/run-nightly'), { name: 'run-nightly', text: '' });
  assert.deepEqual(commandInput('/review some argument'), { name: 'review', text: 'some argument' });
  assert.equal(commandInput('解释 /run-nightly'), null);
});
test('live token deltas are scoped to the selected session and joined across text parts', () => {
  const previews = new Map();
  const delta = { type: 'session.text.delta', created: 100, data: { sessionID: 'ses_one', assistantMessageID: 'msg_a', ordinal: 0, delta: '接口' } };
  assert.equal(applyTextDelta(previews, delta, 'ses_other'), false);
  assert.equal(applyTextDelta(previews, delta, 'ses_one'), true);
  applyTextDelta(previews, { ...delta, data: { ...delta.data, delta: '成功' } }, 'ses_one');
  applyTextDelta(previews, { ...delta, data: { ...delta.data, ordinal: 1, delta: '[[Raw/笔记]]' } }, 'ses_one');
  assert.equal(previews.get('msg_a').text, '接口成功\n\n[[Raw/笔记]]');
});
test('server request contract: project filtering, pagination, v2 prompt and command', async () => {
  const calls = [];
  const client = new OpenCodeClient(connection, async (url, method, headers, body) => {
    calls.push({ url, method, headers, body: body && JSON.parse(body) });
    if (url.includes('/session?')) return { status: 200, text: JSON.stringify({ data: [{ id: 'ses_day', location: { directory: '/workspace' } }, { id: 'ses_night', location: { directory: '/worktrees/nightly' } }], cursor: { next: 'opaque+=' } }) };
    if (url.endsWith('/session')) return { status: 200, text: '{"data":{"id":"ses_new"}}' };
    return { status: 204, text: '' };
  });
  const result = await client.sessions(); assert.deepEqual(result.data.map(x => x.id), ['ses_day']);
  await client.sessions(result.cursor.next);
  assert.equal(new URL(calls[1].url).searchParams.get('cursor'), 'opaque+=');
  assert.equal(new URL(calls[1].url).searchParams.has('order'), false);
  await client.create('新对话'); assert.deepEqual(calls[2].body, { title: '新对话', location: { directory: '/workspace' } });
  await client.prompt('ses_new', '你好'); assert.deepEqual(calls[3].body, { text: '你好', resume: true });
  await client.command('ses_new', 'run-nightly', ''); assert.deepEqual(calls[4].body, { name: 'run-nightly', text: '' });
  await client.reply('ses_new', 'per_one', 'once'); assert.equal(calls[5].url.endsWith('/permission/per_one/reply'), true);
  assert.deepEqual(calls[5].body, { decision: 'once' });
  assert.equal(calls.every(x => x.headers.Authorization.startsWith('Basic ')), true);
});
test('location-scoped command discovery uses deepObject location syntax', async () => {
  const client = new OpenCodeClient(connection, async url => {
    assert.equal(new URL(url).searchParams.get('location[directory]'), '/workspace');
    return { status: 200, text: '{"data":[{"name":"run-nightly"}]}' };
  });
  assert.equal((await client.commands())[0].name, 'run-nightly');
});
test('authentication and HTML reverse-proxy failures are readable', async () => {
  const unauthorized = new OpenCodeClient(connection, async () => ({ status: 401, text: 'private' }));
  await assert.rejects(() => unauthorized.info(), /登录失败/);
  const html = new OpenCodeClient(connection, async () => ({ status: 200, text: '<html>login</html>' }));
  await assert.rejects(() => html.info(), /未返回 JSON/);
});
