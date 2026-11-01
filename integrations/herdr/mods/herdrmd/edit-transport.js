import { exec, appHome, writeTextFile } from 'herdr';
import { isReadDocument } from './reader-model.js';
import { platform } from 'process';
import { readFile, exists } from 'fs/promises';

// Extended Windows paths reject slash separators; preserve the directory's syntax.
export const localJoin = (directory, name) => `${directory.replace(/[\\/]$/, '')}${directory.includes('\\') ? '\\' : '/'}${name}`;

export class EditTransport {
  constructor(options, vault) { this.options = options; this.vault = vault; this.snapshots = new Map(); }
  async directory() {
    if (!this.prepared) this.prepared = this.local(['relay-prepare']).catch(error => { this.prepared = null; throw error; });
    return this.prepared;
  }
  async local(args) {
    const result = await exec(this.options.localBinary || localJoin(localJoin(localJoin(appHome(), 'mods'), 'herdrmd'), `herdrmd${platform === 'win32' || platform === 'windows' ? '.exe' : ''}`), args);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `로컬 저장 실패 (${result.code})`);
    return JSON.parse(result.stdout);
  }
  key(path) { return JSON.stringify([this.options.machine || '', this.options.binary, this.vault, path]); }
  async file(path) {
    const key = this.key(path);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < key.length; i++) { a = Math.imul(a ^ key.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ key.charCodeAt(i); }
    return localJoin((await this.directory()).drafts, `draft-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}.json`);
  }
  async load(path) {
    const file = await this.file(path), raw = await exists(file) ? await readFile(file, 'utf8') : null;
    this.snapshots.set(path, raw);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value.key !== this.key(path)) throw new Error('초안 식별자가 일치하지 않습니다.');
    return value;
  }
  async persist(path, draft) {
    const raw = JSON.stringify({ key: this.key(path), ...draft });
    await writeTextFile(await this.file(path), raw, this.snapshots.get(path) ?? null);
    this.snapshots.set(path, raw);
  }
  async archive(path, draft) {
    await writeTextFile(localJoin((await this.directory()).drafts, `recovered-${Date.now()}-${Math.random().toString(36).slice(2)}.json`), JSON.stringify({ key: this.key(path), ...draft }), null);
  }
  async write(path, revision, text) {
    const file = localJoin((await this.directory()).directory, `request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await writeTextFile(file, JSON.stringify({ binary: this.options.binary, ...(this.options.machine ? { machine: this.options.machine } : {}), vault: this.vault, path, expected_revision: revision, text }), null);
    const document = await this.local(['relay', '--request', file]);
    if (!isReadDocument(document, path) || document.read_only) throw new Error('잘못된 저장 응답입니다. 초안을 유지합니다.');
    return document;
  }
}
