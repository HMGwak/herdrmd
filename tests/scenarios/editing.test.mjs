import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const root = new URL('../../integrations/herdr/mods/herdrmd/', import.meta.url);
const modules = new Map();
async function url(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(new URL(name, root), 'utf8');
  for (const match of [...source.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await url(match[1])}'`);
  const result = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(name, result); return result;
}
const { EditModel } = await import(await url('edit-model.js'));
const { renderCheckboxes, toggleCheckbox } = await import(await url('checkboxes.js'));
const note = (path = '한글.md', text = '- [ ] same\n') => ({ path, text, revision: 'a'.repeat(64), read_only: false });
const deferred = () => { let resolve; const promise = new Promise(ok => resolve = ok); return { resolve, promise }; };

test('inflight edits queue behind new revision and retain newest content across navigation', async () => {
  const first = deferred(), calls = [], drafts = new Map();
  const model = new EditModel({ load: async () => null, persist: async (p, d) => drafts.set(p, d), write: async (path, revision, text) => {
    calls.push({ revision, text }); if (calls.length === 1) await first.promise;
    return { ...note(path, text), revision: calls.length === 1 ? 'b'.repeat(64) : 'c'.repeat(64) };
  } });
  await model.attach(note()); model.edit('한글.md', 'first'); const saving = model.flush('한글.md');
  await new Promise(ok => setImmediate(ok));
  await model.attach(note('other.md')); model.edit('한글.md', 'latest'); first.resolve(); await saving;
  assert.deepEqual(calls.map(c => c.text), ['first', 'latest']);
  assert.equal(calls[1].revision, 'b'.repeat(64));
  assert.equal(model.states.get('한글.md').text, 'latest');
  assert.equal(drafts.get('한글.md').dirty, false);
});

test('failure preserves durable draft, restart restores, retry saves, reload archives', async () => {
  const drafts = new Map(), archive = [];
  let fail = true;
  const options = { load: async p => drafts.get(p), persist: async (p, d) => drafts.set(p, d), write: async (p, rev, text) => {
    if (fail) throw new Error('conflict'); return { ...note(p, text), revision: 'b'.repeat(64) };
  } };
  const a = new EditModel(options); await a.attach(note()); a.edit('한글.md', 'changed'); await a.flush('한글.md');
  assert.equal(a.states.get('한글.md').status, '저장 실패');
  const b = new EditModel(options); await b.attach(note()); assert.equal(b.states.get('한글.md').text, 'changed');
  fail = false; await b.flush('한글.md'); assert.equal(b.states.get('한글.md').dirty, false);
  b.edit('한글.md', 'unsaved'); await b.reload('한글.md', async () => note('한글.md', 'remote'), async (_, d) => archive.push(d));
  assert.equal(archive[0].text, 'unsaved'); assert.equal(b.states.get('한글.md').text, 'remote');
});

test('draft persistence failure prevents remote writes', async () => {
  let writes = 0;
  const model = new EditModel({ load: async () => null, persist: async () => { throw new Error('disk'); }, write: async () => { writes++; } });
  await model.attach(note()); model.edit('한글.md', 'text'); await model.flush('한글.md'); assert.equal(writes, 0);
});

test('checkbox offsets preserve all bytes except one state character; excludes examples and metadata', () => {
  const text = '\uFEFF---\r\n- [ ] metadata\r\n---\r\n- [ ] 한글 same\r\n  - [X] same\r\n- [?] custom\r\n- [-] custom\r\n```md\r\n- [ ] example\r\n```\r\n<!--\r\n- [ ] comment\r\n-->\r\n    - [ ] code\r\n<pre>\r\n- [ ] html\r\n</pre>\r\n';
  const rendered = renderCheckboxes(text, 'one'); assert.equal(rendered.byUrl.size, 2);
  for (const target of rendered.byUrl.values()) {
    const next = toggleCheckbox(text, target);
    assert.equal(next.length, text.length);
    assert.equal([...text].filter((c, i) => c !== [...next][i]).length, 1);
    const again = renderCheckboxes(next, 'two');
    const same = [...again.byUrl.values()].find(t => t.position === target.position);
    assert.equal(toggleCheckbox(next, same)[target.position], target.status === ' ' ? ' ' : 'x');
  }
  assert.notEqual([...rendered.byUrl.keys()][0], [...renderCheckboxes(text, 'two').byUrl.keys()][0]);
});

test('local persistence can be retried after transient failure', async () => {
  let fail = true, writes = 0;
  const model = new EditModel({ load: async () => null, persist: async () => { if (fail) throw new Error('disk'); }, write: async (path, rev, text) => { writes++; return note(path, text); } });
  await model.attach(note()); model.edit('한글.md', 'retry'); await model.flush('한글.md');
  fail = false; await model.flush('한글.md'); assert.equal(writes, 1); assert.equal(model.states.get('한글.md').status, '저장됨');
});

test('reload freezes edits until archived draft and remote read complete', async () => {
  const pending = deferred(), archives = [];
  const model = new EditModel({ load: async () => null, persist: async () => {}, write: async () => {} });
  await model.attach(note()); model.edit('한글.md', 'preserved');
  const reload = model.reload('한글.md', () => pending.promise, async (path, draft) => archives.push(draft));
  assert.equal(model.edit('한글.md', 'too late'), false);
  await new Promise(ok => setImmediate(ok)); assert.equal(archives[0].text, 'preserved');
  pending.resolve(note('한글.md', 'remote')); await reload;
  assert.equal(model.edit('한글.md', 'allowed'), true);
});

test('multiline code spans and Obsidian comments cannot become task targets', () => {
  assert.equal(renderCheckboxes('`inline\n- [ ] code\n`\n%%\n- [ ] comment\n%%\n- [ ] yes', 'scope').byUrl.size, 1);
});

test('lost acknowledgement restores already committed content without stale conflict', async () => {
  const model = new EditModel({ load: async () => ({ dirty: true, text: 'committed', revision: 'b'.repeat(64) }), persist: async () => {}, write: async () => {} });
  const state = await model.attach(note('한글.md', 'committed'));
  assert.equal(state.dirty, false); assert.equal(state.revision, 'a'.repeat(64));
});

test('autosave or Save during original reload cannot publish discarded draft', async () => {
  const pending = deferred(); let writes = 0;
  const model = new EditModel({ load: async () => null, persist: async () => {}, write: async () => { writes++; } });
  await model.attach(note()); model.edit('한글.md', 'discarded');
  const reloading = model.reload('한글.md', () => pending.promise, async () => {});
  await new Promise(ok => setImmediate(ok));
  await model.flush('한글.md'); assert.equal(writes, 0);
  pending.resolve(note('한글.md', 'original')); await reloading;
  await model.flush('한글.md'); assert.equal(writes, 0);
  assert.equal(model.states.get('한글.md').text, 'original');
});

test('native editor change callback debounces, ignores programmatic sync, and saves original document after navigation', async () => {
  const viewSource = await readFile(new URL('vault-view.js', root), 'utf8');
  const fakeNative = `
    const EditorState = { new() {
      let text = '', handler;
      return { value: () => text, set_value(value) { text = value; }, on(event, callback) { if (event === 'change') handler = callback; },
        input(value, cx) { text = value; handler({}, cx); }, release() {} };
    } };
  `;
  const { VaultReader } = await import(`data:text/javascript;base64,${Buffer.from(fakeNative + viewSource.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  const { ReaderModel } = await import(await url('reader-model.js'));
  const writes = [], waits = [], tasks = [];
  const reader = Object.create(VaultReader.prototype);
  reader.closed = false;
  reader.model = new ReaderModel(async (_, path) => note(path, 'original'));
  reader.edits = new EditModel({ load: async () => null, persist: async () => {}, write: async (path, rev, text) => { writes.push({ path, text }); return note(path, text); }, changed: path => {
    const state = reader.edits.states.get(path); reader.model.documents.set(path, { ...state.document, text: state.text });
  } });
  await reader.model.open('first.md'); await reader.edits.attach(reader.model.document);
  reader.createEditor(false); reader.syncEditor();
  const cx = { notify() {}, sleep(ms) { assert.equal(ms, 1000); const d = deferred(); waits.push(d); return d.promise; }, spawn(callback) { tasks.push(callback(cx)); } };
  // set_value is the native programmatic operation and produces no user edit.
  assert.equal(reader.edits.states.get('first.md').dirty, false);
  reader.editor.input('one', cx); reader.editor.input('latest', cx);
  assert.equal(reader.edits.states.get('first.md').text, 'latest');
  await reader.model.open('second.md'); await reader.edits.attach(reader.model.document); reader.syncEditor();
  assert.equal(reader.editor.value(), 'original');
  assert.equal(reader.edits.states.get('second.md').dirty, false);
  waits[0].resolve(); await tasks[0]; assert.deepEqual(writes, []);
  waits[1].resolve(); await tasks[1]; assert.deepEqual(writes, [{ path: 'first.md', text: 'latest' }]);
  assert.equal(reader.editor.value(), 'original');
});

test('normal task after fenced example remains clickable', () => {
  assert.equal(renderCheckboxes('```md\n- [ ] code\n```\n- [ ] after\n', 'after').byUrl.size, 1);
});

test('local transport preserves Windows extended path separators and macOS paths', async () => {
  const source = await readFile(new URL('edit-transport.js', root), 'utf8');
  const { localJoin } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  assert.equal(localJoin('C:\\Users\\Test\\drafts', 'note.json'), 'C:\\Users\\Test\\drafts\\note.json');
  assert.equal(localJoin('\\\\?\\C:\\Users\\Test\\drafts', 'note.json'), '\\\\?\\C:\\Users\\Test\\drafts\\note.json');
  assert.equal(localJoin('/Users/test/drafts/', 'note.json'), '/Users/test/drafts/note.json');
});

test('deferred native normalization events do not dirty CRLF source; user changes retain CRLF', async () => {
  const viewSource = await readFile(new URL('vault-view.js', root), 'utf8');
  const stub = `const EditorState = { new() { let value='', handler; return { value: () => value, set_value(text) { value=text.replace(/\\r\\n/g,'\\n'); }, on(_, fn) { handler=fn; }, release() {}, fire(cx) { handler({},cx); } }; } };`;
  const { VaultReader } = await import(`data:text/javascript;base64,${Buffer.from(stub + viewSource.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  const reader = Object.create(VaultReader.prototype), document = { ...note('crlf.md', 'original\r\n'), line_endings: 'crlf' };
  reader.model = { selected: document.path, document };
  reader.edits = new EditModel({ load: async () => null, persist: async () => {}, write: async () => {} });
  const state = await reader.edits.attach(document);
  reader.createEditor(false); reader.syncEditor();
  const cx = { notify() {}, spawn() {} };
  reader.editor.fire(cx);
  assert.equal(state.dirty, false); assert.equal(state.text, 'original\r\n');
  reader.editor.set_value('edited\n'); reader.editor.fire(cx);
  assert.equal(state.text, 'edited\r\n'); assert.equal(state.version, 1);
  reader.editor.fire(cx); assert.equal(state.version, 1);
});

test('transport draft CAS snapshots follow serialized checkpoints across rapid edits and save', async () => {
  const source = await readFile(new URL('edit-transport.js', root), 'utf8');
  const files = new Map(), cas = [], gate = deferred(); let calls = 0;
  globalThis.__draftTransportTest = {
    exists: async path => files.has(path), readFile: async path => files.get(path),
    writeTextFile: async (path, text, expected) => {
      calls++; if (calls === 1) await gate.promise;
      assert.equal(files.get(path) ?? null, expected);
      cas.push({ path, text, expected }); files.set(path, text);
    },
  };
  const prelude = 'const { exists, readFile, writeTextFile } = globalThis.__draftTransportTest;';
  const { EditTransport } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  const transport = new EditTransport({ binary: '/herdrmd', machine: 'test' }, 'synthetic');
  transport.directory = async () => ({ directory: '/requests', drafts: '/drafts' });
  const model = new EditModel({ load: path => transport.load(path), persist: (path, draft) => transport.persist(path, draft), write: async (path, rev, text) => note(path, text) });
  await model.attach(note()); model.edit('한글.md', 'one');
  await new Promise(ok => setImmediate(ok)); model.edit('한글.md', 'two'); const saving = model.flush('한글.md');
  gate.resolve(); await saving;
  assert.equal(cas.length, 3);
  for (let i = 1; i < cas.length; i++) assert.equal(cas[i].expected, cas[i - 1].text);
  assert.equal(JSON.parse(cas.at(-1).text).dirty, false);
  delete globalThis.__draftTransportTest;
});

test('original reload archives a blocked unreadable draft before replacing it', async () => {
  const archive = [];
  const model = new EditModel({ load: async () => { throw new Error('invalid JSON'); }, persist: async () => {}, write: async () => {} });
  const state = await model.attach(note());
  assert.equal(state.blocked, true);
  await model.reload('한글.md', async () => note('한글.md', 'remote'), async (path, draft) => archive.push({ path, draft }));
  assert.equal(archive.length, 1);
  assert.equal(archive[0].path, '한글.md');
});

test('transport recovery preserves the exact unreadable draft instead of discarding its raw bytes', async () => {
  const source = await readFile(new URL('edit-transport.js', root), 'utf8');
  let broken = '{"text":"synthetic lost draft",';
  const files = new Map();
  globalThis.__brokenDraftTest = {
    exists: async () => true, readFile: async () => broken,
    writeTextFile: async (path, raw) => files.set(path, JSON.parse(raw)),
  };
  const prelude = 'const { exists, readFile, writeTextFile } = globalThis.__brokenDraftTest;';
  const { EditTransport } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  delete globalThis.__brokenDraftTest;
  const transport = new EditTransport({ binary: '/synthetic/herdrmd' }, 'synthetic');
  transport.directory = async () => ({ drafts: '/synthetic/drafts' });
  await assert.rejects(transport.load('note.md'), SyntaxError);
  await transport.archive('note.md', { text: 'remote', dirty: false });
  assert.equal([...files.values()][0].source, broken);
  broken = JSON.stringify({ key: transport.key('note.md'), text: 'unrecognized draft', revision: 'invalid', dirty: true });
  await assert.rejects(transport.load('note.md'), /초안 형식/);
  await transport.archive('note.md', { text: 'remote', dirty: false });
  assert.equal([...files.values()].at(-1).source, broken);
});

test('Retry re-reads a previously inaccessible draft and restores it before any remote write', async () => {
  let failed = true, writes = 0;
  const model = new EditModel({ load: async () => {
    if (failed) throw new Error('temporarily unavailable');
    return { text: 'recovered', revision: 'a'.repeat(64), dirty: true };
  }, persist: async () => {}, write: async () => { writes++; return note(); } });
  await model.attach(note());
  failed = false;
  await model.retry('한글.md');
  assert.equal(model.states.get('한글.md').text, 'recovered');
  assert.equal(model.states.get('한글.md').dirty, true);
  assert.equal(model.states.get('한글.md').blocked, undefined);
  assert.equal(writes, 0);
});

test('rapid edits coalesce durable checkpoints while preserving the final draft before remote save', async () => {
  const gate = deferred(), persisted = [], written = [];
  const model = new EditModel({ load: async () => null, persist: async (_, draft) => {
    persisted.push(draft.text);
    if (persisted.length === 1) await gate.promise;
  }, write: async (path, revision, text) => { written.push(text); return note(path, text); } });
  await model.attach(note());
  model.edit('한글.md', 'first');
  await new Promise(ok => setImmediate(ok));
  for (let i = 0; i < 100; i++) model.edit('한글.md', `edit ${i}`);
  const saving = model.flush('한글.md');
  assert.deepEqual(persisted, ['first']);
  gate.resolve();
  await saving;
  assert.deepEqual(written, ['edit 99']);
  assert.equal(persisted.at(-1), 'edit 99');
  assert.ok(persisted.length <= 3);
});

test('syncEditor does not reset native CRLF/CR editor selection after autosave', async () => {
  const viewSource = await readFile(new URL('vault-view.js', root), 'utf8');
  const { VaultReader } = await import(`data:text/javascript;base64,${Buffer.from(viewSource.replace(/^import .*;\n/gm, '')).toString('base64')}`);
  for (const ending of ['\r\n', '\r']) {
    const reader = Object.create(VaultReader.prototype);
    let resets = 0;
    reader.closed = false;
    const before = note('normalized.md', `edited${ending}text`), after = { ...before, revision: 'b'.repeat(64) };
    reader.model = { selected: before.path, document: after };
    reader.edits = { states: new Map([[before.path, { document: after, text: after.text }]]) };
    reader.editorReadonly = false;
    reader.editorDocument = before;
    reader.editor = { value: () => 'edited\ntext', set_value() { resets++; } };
    reader.syncEditor();
    assert.equal(resets, 0);
    assert.equal(reader.editorBaseline, 'edited\ntext');
    const moved = { ...after, path: 'another.md' };
    reader.model.document = moved;
    reader.model.selected = moved.path;
    reader.edits.states.set(moved.path, { document: moved, text: moved.text });
    reader.syncEditor();
    assert.equal(resets, 1);
  }
});

test('coalesced checkpoint failure keeps the newest draft and retries before a remote write', async () => {
  const gate = deferred(), persisted = [], written = [];
  let fail = true;
  const model = new EditModel({ load: async () => null, persist: async (_, draft) => {
    persisted.push(draft.text);
    if (fail) { await gate.promise; throw Error('synthetic disk failure'); }
  }, write: async (path, revision, text) => { written.push(text); return note(path, text); } });
  await model.attach(note());
  model.edit('한글.md', 'one');
  await new Promise(ok => setImmediate(ok));
  model.edit('한글.md', 'latest');
  const saving = model.flush('한글.md');
  gate.resolve();await saving;
  assert.deepEqual(written, []);
  assert.equal(model.states.get('한글.md').text, 'latest');
  fail = false;await model.retry('한글.md');
  assert.deepEqual(written, ['latest']);
  assert.equal(model.states.get('한글.md').dirty, false);
  assert.equal(persisted.at(-1), 'latest');
});

test('original reload archives after a failed draft CAS while preserving the competing draft', async () => {
  const archives = [];
  const model = new EditModel({ load: async () => null, persist: async () => { throw Error('CAS mismatch'); }, write: async () => { throw Error('must not write'); } });
  const state = await model.attach(note());
  model.edit('한글.md', 'my preserved draft');
  await state.queue.catch(() => {});
  const original = await model.reload('한글.md', async () => note('한글.md', 'current original'), async (path, draft) => archives.push(draft));
  assert.equal(archives[0].text, 'my preserved draft');
  assert.equal(original.text, 'current original');
  assert.equal(state.text, 'current original');
  assert.equal(state.blocked, true);
  assert.match(state.error, /CAS mismatch/);
});
