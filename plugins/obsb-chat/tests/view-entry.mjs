export { default } from '../src/main.ts';
export { copyMessage } from '../src/clipboard.ts';
export { Notice } from 'obsidian';
export { Platform } from 'obsidian';
export { Modal } from 'obsidian';
export { FormCards } from '../src/forms.ts';
import { TFile } from 'obsidian';
export const createMockFile = path => new TFile(path);
