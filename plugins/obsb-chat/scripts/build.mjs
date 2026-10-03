import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/obsb-chat', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/obsb-chat/main.js', bundle: true,
  external: ['obsidian'], format: 'cjs', platform: 'browser', target: 'es2020', sourcemap: false });
for (const name of ['manifest.json', 'styles.css']) await copyFile(name, `dist/obsb-chat/${name}`);
console.log('Built dist/obsb-chat (Windows / Android, no Node runtime required)');
