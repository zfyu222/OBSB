// Verify only newly created temporary sessions; never enumerate/delete user history.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/client.ts'], outfile: '.test-build/client.mjs', bundle: true, platform: 'node', format: 'esm' });
const { OpenCodeClient } = await import('../.test-build/client.mjs');
const values = Object.fromEntries((await readFile('../../secrets.local.env', 'utf8')).split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
const client = new OpenCodeClient({ serverUrl: 'https://brain.hytzfy.dpdns.org:40087', username: 'opencode', password: values.OPENCODE_SERVER_PASSWORD, directory: '/workspace' }, async (url, method, headers, body) => {
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
  return { status: response.status, text: await response.text() };
});
const unwrap = value => value?.data ?? value;
const temporary = [];
async function wait(check) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 1000)); }
  throw new Error('Temporary feature test timed out');
}
async function idle(id) {
  await wait(async () => {
    const [active, permissions, forms] = await Promise.all([client.active(), client.permissions(id), client.forms(id)]);
    if (permissions.length) throw new Error('Unexpected permission request in temporary feature test');
    if (forms.length) throw new Error('Unexpected pending form');
    const messages = await client.messages(id);
    const error = messages.data.find(message => message.error);
    if (error) throw new Error(error.error.message);
    return !(id in active);
  });
}
try {
  console.log(JSON.stringify({ serverVersion: (await client.info()).version }));
  const session = await client.create('Temporary plugin feature test'); temporary.push(session.id);
  const createForm = async payload => unwrap(await client.request('POST', `/session/${session.id}/form`, payload));
  const form = await createForm({ title: 'Temporary option form', fields: [
    { key: 'choice', type: 'string', required: true, custom: true, options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }] },
    { key: 'many', type: 'multiselect', required: true, custom: true, options: [{ value: 'a', label: '甲' }] },
    { key: 'flag', type: 'boolean', required: true }, { key: 'number', type: 'integer', required: true },
  ] });
  assert.ok((await client.forms(session.id)).some(item => item.id === form.id));
  await client.answerForm(session.id, form.id, { choice: '自己的答案', many: ['a', '额外答案'], flag: false, number: 0 });
  const detail = unwrap(await client.request('GET', `/session/${session.id}/form/${form.id}`));
  assert.equal(detail.state.status, 'answered');
  const cancel = await createForm({ title: 'Temporary cancel form', fields: [{ key: 'text', type: 'string' }] });
  await client.cancelForm(session.id, cancel.id);
  assert.equal(unwrap(await client.request('GET', `/session/${session.id}/form/${cancel.id}`)).state.status, 'cancelled');
  console.log(JSON.stringify({ formReplyVerified: true, customAndMultipleVerified: true, cancellationVerified: true }));
  if (process.argv.includes('--question')) {
    await client.prompt(session.id, '这是插件接口测试，不读取、不搜索、不编辑任何文件。请只调用 question 工具询问两道测试问题：第一题单选甲或乙，第二题多选红或蓝。收到回答后仅回复“表单测试完成”，不调用其他工具。');
    const forms = await wait(async () => { const forms = await client.forms(session.id); return forms.length ? forms : undefined; });
    for (const form of forms) {
      const answer = Object.fromEntries(form.fields.map(field => [field.key, field.type === 'multiselect' ? [field.options[0].value] : field.options[0].value]));
      await client.answerForm(session.id, form.id, answer);
    }
    await idle(session.id);
    const messages = await client.messages(session.id);
    assert.ok(messages.data.some(message => message.content?.some(part => part.type === 'text' && part.text?.includes('表单测试完成'))));
    console.log(JSON.stringify({ actualQuestionToolVerified: true, fieldTypes: forms.flatMap(form => form.fields.map(field => field.type)) }));
    await client.compact(session.id); await idle(session.id);
    const context = unwrap(await client.request('GET', `/session/${session.id}/context`));
    console.log(JSON.stringify({ compactionAccepted: true, contextTypes: context.map(message => message.type) }));
    assert.ok(context.some(message => message.type === 'compaction'), 'Expected a compaction message in active context');
  }
  const independent = await client.create('Temporary deletion scope control'); temporary.push(independent.id);
  await client.remove(session.id);
  await assert.rejects(() => client.session(session.id), error => error.status === 404);
  assert.equal((await client.session(independent.id)).id, independent.id);
  console.log(JSON.stringify({ selectedDeletionVerified: true, unselectedSessionPreserved: true }));
} finally {
  for (const id of temporary.reverse()) {
    try { await client.interrupt(id); } catch { /* Session may already have been removed. */ }
    try { await client.remove(id); } catch (error) { if (error.status !== 404) throw error; }
  }
  console.log('Temporary feature sessions removed');
}
