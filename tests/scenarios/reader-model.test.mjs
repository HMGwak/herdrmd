import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const source = await readFile(new URL("../../integrations/herdr/mods/herdrmd/reader-model.js", import.meta.url), "utf8");
const { ReaderModel, documentStatus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const note = (text) => ({ text, bytes: Buffer.byteLength(text), encoding: "utf-8", bom: false, line_endings: "crlf" });

test("a slow response cannot replace the latest selected document", async () => {
  const pending = new Map();
  const model = new ReaderModel((_operation, path) => { const call = deferred(); pending.set(path, call); return call.promise; });
  const first = model.open("alpha.md"), second = model.open("beta.md");
  pending.get("beta.md").resolve(note("# Beta")); await second;
  pending.get("alpha.md").resolve(note("# Alpha")); await first;
  assert.equal(model.selected, "beta.md");
  assert.equal(model.document.text, "# Beta");
  assert.equal(model.readLoading, false);
});

test("an obsolete read failure cannot overwrite a successful selection", async () => {
  const earlier = deferred();
  const model = new ReaderModel((_operation, path) => path === "old.md" ? earlier.promise : Promise.resolve(note("current")));
  const first = model.open("old.md");
  await model.open("current.md");
  earlier.reject(new Error("old request disconnected")); await first;
  assert.equal(model.readError, "");
  assert.equal(model.document.text, "current");
});

test("folder navigation discards both obsolete results and obsolete failures", async () => {
  const old = deferred(), middle = deferred();
  const model = new ReaderModel((_operation, path) => path === "old" ? old.promise : path === "middle" ? middle.promise : Promise.resolve({ entries: [{ name: "new.md", path: "new/new.md", directory: false }], truncated: true }));
  const first = model.list("old"), second = model.list("middle");
  await model.list("new");
  old.resolve({ entries: [], truncated: false });
  middle.reject(new Error("obsolete folder error"));
  await Promise.all([first, second]);
  assert.equal(model.directory, "new");
  assert.equal(model.entries[0].name, "new.md");
  assert.equal(model.truncated, true);
  assert.equal(model.listError, "");
  assert.equal(model.listLoading, false);
});

test("switching cached tabs cancels an in-flight selection; refresh rereads exact source", async () => {
  const slow = deferred(), raw = "# 합성 문서\r\n\r\n[[원문 링크]]\r\n";
  const calls = [];
  const model = new ReaderModel((_operation, path) => { calls.push(path); return path === "slow.md" ? slow.promise : Promise.resolve(note(raw)); });
  await model.open("source.md");
  const pending = model.open("slow.md");
  await model.open("source.md");
  slow.resolve(note("outdated")); await pending;
  assert.equal(model.document.text, raw);
  assert.equal(calls.filter((path) => path === "source.md").length, 1);
  await model.open("source.md", true);
  assert.equal(calls.filter((path) => path === "source.md").length, 2);
  assert.equal(model.document.text, raw);
  assert.match(documentStatus(model.document), /utf-8.*crlf/);
});

test("closing the selected tab selects its neighbor and invalidates a pending read", async () => {
  const slow = deferred();
  const model = new ReaderModel((_operation, path) => path === "slow.md" ? slow.promise : Promise.resolve(note("neighbor")));
  await model.open("neighbor.md");
  const pending = model.open("slow.md");
  await model.closeTab("slow.md");
  slow.resolve(note("closed")); await pending;
  assert.deepEqual(model.tabs, ["neighbor.md"]);
  assert.equal(model.selected, "neighbor.md");
  assert.equal(model.document.text, "neighbor");
  assert.equal(model.documents.has("slow.md"), false);
  await model.closeTab("neighbor.md");
  assert.equal(model.selected, "");
  assert.equal(model.document, undefined);
});

test("closed readers ignore pending folder and document work", async () => {
  const list = deferred(), read = deferred();
  const model = new ReaderModel((operation) => operation === "files" ? list.promise : read.promise);
  const listing = model.list("folder"), reading = model.open("folder/synthetic.md");
  model.close();
  list.resolve({ entries: [{ name: "stale.md" }], truncated: false });
  read.resolve(note("late text"));
  await Promise.all([listing, reading]);
  assert.equal(model.directory, "");
  assert.deepEqual(model.entries, []);
  assert.equal(model.document, undefined);
  await model.open("another.md");
  assert.equal(model.documents.size, 0);
});

const readerSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/vault-view.js", import.meta.url), "utf8");
const lifecycle = { pending: [], writes: [], released: 0, settingsClosed: 0, notifications: 0 };
globalThis.__herdrmdReaderLifecycle = lifecycle;
const readerPrelude = `
import { ReaderModel, parentPath, fileTitle, documentStatus } from "data:text/javascript;base64,${Buffer.from(source).toString("base64")}";
const state = globalThis.__herdrmdReaderLifecycle;
const exec = async (binary, args, options) => {
  let resolve;
  const promise = new Promise(ok => { resolve = ok; });
  state.pending.push({ binary, args, options, resolve });
  return promise;
};
const nextCommand = () => new Promise(() => {});
const EditorState = { new() { return {
  set_value(value) { if (state.released) throw new Error("editor used after release"); state.writes.push(value); },
  release() { state.released += 1; },
}; } };
class VaultSettings { close() { state.settingsClosed += 1; } }
`;
const { VaultReader } = await import(`data:text/javascript;base64,${Buffer.from(readerPrelude + readerSource.replace(/^import .*;\n/gm, "")).toString("base64")}`);
delete globalThis.__herdrmdReaderLifecycle;

test("reader teardown releases once and never writes late text into the native Editor", async () => {
  const tasks = [];
  const cx = {
    spawn(handler) { const task = Promise.resolve().then(() => handler(cx)); tasks.push(task); },
    notify() { lifecycle.notifications += 1; },
  };
  const reader = new VaultReader({ binary: "/opt/herdrmd", machine: "synthetic-nas", vault: "test", file: "synthetic.md" }, cx);
  await Promise.resolve();
  assert.equal(lifecycle.pending.length, 2);
  for (const request of lifecycle.pending) {
    assert.equal(request.binary, "/opt/herdrmd");
    assert.deepEqual(request.options, { on: "synthetic-nas" });
    assert.equal(request.args[2], "test");
  }
  reader.close(); reader.close();
  const notificationsAtClose = lifecycle.notifications, writesAtClose = lifecycle.writes.length;
  for (const request of lifecycle.pending) request.resolve({ code: 0, stdout: JSON.stringify(request.args[0] === "files" ? { entries: [], truncated: false } : note("late synthetic text")) });
  await Promise.all(tasks.slice(0, 2));
  assert.equal(lifecycle.released, 1);
  assert.equal(lifecycle.settingsClosed, 1);
  assert.equal(lifecycle.writes.length, writesAtClose);
  assert.equal(lifecycle.notifications, notificationsAtClose);
});
