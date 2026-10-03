import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['src/protocol.ts', 'src/client.ts'], outdir: '.test-build', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
await build({ entryPoints: ['tests/view-entry.mjs'], outfile: '.test-build/main.mjs', bundle: true, platform: 'node', format: 'esm', alias: { obsidian: './tests/obsidian-mock.mjs' } });
const result = spawnSync(process.execPath, ['--test', 'tests/client.test.mjs', 'tests/view.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
