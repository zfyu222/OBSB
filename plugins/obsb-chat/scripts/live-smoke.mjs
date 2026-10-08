// Read secrets in-process; never include values in commands, output or artifacts.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({ entryPoints: ['src/client.ts'], outfile: '.test-build/client.mjs', bundle: true, platform: 'node', format: 'esm' });
const { OpenCodeClient } = await import('../.test-build/client.mjs');
const values = Object.fromEntries((await readFile('../../secrets.local.env', 'utf8')).split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
const client = new OpenCodeClient({ serverUrl: 'https://brain.hytzfy.dpdns.org:40087', username: 'opencode', password: values.OPENCODE_SERVER_PASSWORD, directory: '/workspace' }, async (url, method, headers, body) => {
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
  return { status: response.status, text: await response.text() };
});
const info = await client.info();
const sessions = await client.sessions();
const commands = await client.commands();
console.log(JSON.stringify({ version: info.version, workspaceSessions: sessions.data.length, nightlyCommandAvailable: commands.some(x => x.name === 'run-nightly') }));
if (!process.argv.includes('--prompt')) process.exit(0);
let session;
const abort = new AbortController(); let eventCount = 0; const eventTypes = new Set(); let sampleDelta;
const subscription = client.subscribe(abort.signal, event => {
  eventCount++;
  if (event?.type) eventTypes.add(event.type);
  if (event?.type === 'session.text.delta' && !sampleDelta) sampleDelta = event;
}, () => console.log('SSE connected')).catch(error => { if (!abort.signal.aborted) console.log('SSE unavailable:', error.message); });
try {
  session = await client.create();
  await client.prompt(session.id, '这是聊天接口测试，不读取、不搜索、不编辑任何文件，不调用工具。请仅回答：接口测试成功 [[Raw/项目/夜间整理/夜间整理验收测试|引用测试]]');
  const deadline = Date.now() + 90000; let seen = false; let completed = false; let response;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const [messages, active, permissions] = await Promise.all([client.messages(session.id), client.active(), client.permissions(session.id)]);
    if (permissions.length) throw new Error('Unexpected permission request');
    const assistants = messages.data.filter(x => x.type === 'assistant');
    if (assistants.length) { seen = true; response = assistants.at(0); }
    if (seen && !(session.id in active)) {
      if (response.error) throw new Error(response.error.message);
      completed = true;
      console.log(JSON.stringify({ promptCompleted: true, assistantText: response.content?.some(x => x.type === 'text' && x.text), eventCount, eventTypes: [...eventTypes], sampleDelta }));
      break;
    }
  }
  if (!completed) throw new Error('Prompt timed out');
  // Same creation payload as the plugin; verify asynchronous server naming.
  let named = false;
  const titleDeadline = Date.now() + 30000;
  while (Date.now() < titleDeadline) {
    const current = await client.session(session.id);
    if (current.title && current.title !== session.title && !/^New session\b/.test(current.title)) {
      named = true; console.log(JSON.stringify({ automaticTitle: current.title })); break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!named) throw new Error('Server automatic title was not observed');
} finally {
  abort.abort(); await subscription;
  if (session) { await client.interrupt(session.id); await client.request('DELETE', '/session/' + encodeURIComponent(session.id)); console.log('Removed temporary test session'); }
}
