import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../integrations/herdr/mods/herdrmd/ask-agent.js', import.meta.url), 'utf8');
const { AskAgent, localSource, readyToAsk } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const origin = { pane: 'reader', tab: 'tab', space: 'local' };
function fixture() {
  const calls = [], list = [], state = { error: '', dirty: true };
  const model = { selected: '한글 폴더/문서.md', document: { text: 'PRIVATE BODY' } };
  let closed = false;
  const host = {
    closed: () => closed, source: () => origin, panes: () => list,
    ready: (p, saved) => readyToAsk(model, { states: new Map([[model.selected, state]]) }, p, saved),
    vault: async () => '/tmp/한글 볼트 $(no-shell)', skill: () => '/Users/test/.codex/skills/obsidian-markdown/SKILL.md',
    readSkill: async () => 'skill', checkCodex: async () => {},
    save: async () => { calls.push('save'); state.dirty = false; },
    command: async (name, args) => { calls.push({ name, args }); list.push({ pane: 'agent' }); return { pane: 'agent' }; },
  };
  return { host, calls, list, state, model, agent: new AskAgent(host), close: () => { closed = true; } };
}
test('local identity is explicit and remote or missing sources fail closed', () => {
  const panes = [{ pane: 'reader', tab: 'tab', mod: 'herdrmd' }];
  const spaces = [{ id: 'local', tabs: [{ id: 'tab' }], machine: null }];
  assert.deepEqual(localSource({}, 'reader', panes, spaces), origin);
  assert.throws(() => localSource({ machine: 'nas' }, 'reader', panes, spaces));
  assert.throws(() => localSource({}, 'reader', panes, [{ ...spaces[0], machine: 'remote' }]));
  assert.throws(() => localSource({}, 'other', panes, spaces));
});
test('save then right split uses exact argument boundaries, paths and skill only; reuse and relaunch', async () => {
  const f = fixture(); await f.agent.start(origin, f.model.selected);
  assert.equal(f.calls[0], 'save');
  const call = f.calls[1]; assert.equal(call.name, 'pane.split');
  assert.equal(call.args.pane, 'reader'); assert.equal(call.args.direction, 'right');
  assert.deepEqual(call.args.argv.slice(0, 8), ['codex', '--no-daemon', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="max"', '-C', '/tmp/한글 볼트 $(no-shell)']);
  const message = call.args.argv[8]; assert.match(message, /한글 폴더\/문서.md/); assert.match(message, /obsidian-markdown\/SKILL.md/);
  assert.doesNotMatch(message, /PRIVATE BODY|nas|dangerously/);
  await f.agent.start(origin, f.model.selected); assert.equal(f.calls.at(-1).name, 'pane.focus');
  f.list.length = 0; await f.agent.start(origin, f.model.selected);
  assert.equal(f.calls.filter(c => c.name === 'pane.split').length, 2);
});
test('pending clicks do not duplicate and closed source before launch cancels', async () => {
  const f = fixture(); let release; f.host.checkCodex = () => new Promise(r => { release = r; });
  const first = f.agent.start(origin, f.model.selected);
  await new Promise(r => setImmediate(r));
  await f.agent.start(origin, f.model.selected); assert.equal(f.calls.length, 0);
  f.close(); release(); await assert.rejects(first); assert.equal(f.calls.length, 0);
});
for (const failure of ['draft', 'read', 'skill', 'codex', 'save', 'moved', 'navigation']) {
  test(`${failure} failure prevents launch`, async () => {
    const f = fixture();
    if (failure === 'draft') f.state.error = '복구 확인';
    if (failure === 'read') f.model.readError = 'read error';
    if (failure === 'skill') f.host.readSkill = async () => null;
    if (failure === 'codex') f.host.checkCodex = async () => { throw Error('missing'); };
    if (failure === 'save') f.host.save = async () => { f.state.error = 'conflict'; };
    if (failure === 'moved') f.host.checkCodex = async () => { f.host.source = () => ({ ...origin, tab: 'other' }); };
    if (failure === 'navigation') f.host.checkCodex = async () => { f.model.selected = 'other.md'; };
    await assert.rejects(f.agent.start(origin, f.model.selected));
    assert.equal(f.calls.filter(c => c.name === 'pane.split').length, 0);
    if (['draft', 'read', 'skill', 'codex'].includes(failure)) assert.equal(f.calls.length, 0);
  });
}
test('source closing during accepted split does not kill independent agent', async () => {
  const f = fixture(); f.host.command = async () => { f.close(); return { pane: 'agent' }; };
  await f.agent.start(origin, f.model.selected); assert.equal(f.agent.linked, 'agent');
});
test('successful simultaneous clicks split once even if window focus changes', async () => {
  const f = fixture(); let release;
  f.host.checkCodex = () => new Promise(r => { release = r; });
  const first = f.agent.start(origin, f.model.selected);
  await new Promise(r => setImmediate(r));
  const second = f.agent.start({ pane: 'other', tab: 'other', space: 'other' }, f.model.selected);
  release(); await Promise.all([first, second]);
  assert.equal(f.calls.filter(c => c.name === 'pane.split').length, 1);
  assert.equal(f.calls.at(-1).args.pane, 'reader');
});
test('missing registry path and split errors release the lock without silent fallback', async () => {
  const f = fixture(); f.host.vault = async () => undefined;
  await assert.rejects(f.agent.start(origin, f.model.selected));
  assert.equal(f.calls.length, 0); assert.equal(f.agent.pending, false);
  f.host.vault = async () => '/tmp/vault';
  f.host.command = async () => { throw Error('split failed'); };
  await assert.rejects(f.agent.start(origin, f.model.selected), /split failed/);
  assert.equal(f.agent.pending, false); assert.equal(f.agent.linked, null);
});
