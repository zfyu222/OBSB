export { default } from '../src/main.ts';
export { copyMessage } from '../src/clipboard.ts';
export { Notice } from 'obsidian';
import { TFile } from 'obsidian';
export const createMockFile = path => new TFile(path);
