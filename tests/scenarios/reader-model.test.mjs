import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const source = await readFile(new URL("../../integrations/herdr/mods/herdrmd/reader-model.js", import.meta.url), "utf8");
const { ReaderModel, documentStatus, TREE_MAX_VISIBLE, TREE_MAX_ENTRIES, TREE_MAX_FOLDERS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
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

const entry = (path, directory = false) => ({ name: path.split("/").pop(), path, directory });
const listing = (entries, truncated = false) => ({ entries, truncated });

test("tree expansion is lazy, keeps the root, and reuses a collapsed folder cache", async () => {
  const calls = [];
  const model = new ReaderModel(async (_operation, path) => {
    calls.push(path);
    return path === "" ? listing([entry("folder", true), entry("root.md")]) : listing([entry("folder/nested", true), entry("folder/note.md")]);
  });
  await model.list("");
  assert.deepEqual(calls, [""]);
  await model.toggleFolder("folder");
  assert.deepEqual(model.visibleEntries.map((item) => item.path), ["folder", "folder/nested", "folder/note.md", "root.md"]);
  assert.deepEqual(model.tree().rows.filter((row) => row.kind === "entry").map((row) => row.depth), [0, 1, 1, 0]);
  assert.equal(model.entries[0].path, "folder");
  await model.toggleFolder("folder");
  assert.deepEqual(model.visibleEntries.map((item) => item.path), ["folder", "root.md"]);
  await model.toggleFolder("folder");
  assert.deepEqual(calls, ["", "folder"]);
  assert.equal(model.visibleEntries[2].path, "folder/note.md");
});

test("collapsing a pending expansion ignores its late result and permits a fresh reopen", async () => {
  const slow = deferred();
  let folderCalls = 0;
  const model = new ReaderModel((_operation, path) => path === "" ? Promise.resolve(listing([entry("folder", true)])) :
    ++folderCalls === 1 ? slow.promise : Promise.resolve(listing([entry("folder/fresh.md")])));
  await model.list("");
  const expanding = model.toggleFolder("folder");
  await Promise.resolve();
  assert.equal(model.folders.get("folder").loading, true);
  await model.toggleFolder("folder");
  slow.resolve(listing([entry("folder/stale.md")])); await expanding;
  assert.equal(model.expanded.has("folder"), false);
  assert.deepEqual(model.folders.get("folder").entries, []);
  assert.equal(model.folders.get("folder").loading, false);
  await model.toggleFolder("folder");
  assert.equal(folderCalls, 2);
  assert.equal(model.visibleEntries[1].path, "folder/fresh.md");
});

test("collapsing a parent closes pending descendants and reopening never leaves a blank expanded branch", async () => {
  const slow = deferred();
  let childCalls = 0;
  const model = new ReaderModel((_operation, path) => {
    if (!path) return Promise.resolve(listing([entry("a", true)]));
    if (path === "a") return Promise.resolve(listing([entry("a/b", true)]));
    return ++childCalls === 1 ? slow.promise : Promise.resolve(listing([entry("a/b/fresh.md")]));
  });
  await model.list(""); await model.toggleFolder("a");
  const child = model.toggleFolder("a/b");
  await Promise.resolve();
  await model.toggleFolder("a");
  assert.equal(model.expanded.has("a/b"), false);
  slow.resolve(listing([entry("a/b/stale.md")])); await child;
  await model.toggleFolder("a");
  assert.equal(model.expanded.has("a/b"), false);
  await model.toggleFolder("a/b");
  assert.equal(childCalls, 2);
  assert.equal(model.visibleEntries[2].path, "a/b/fresh.md");
});

test("refresh invalidates a pending expansion failure and reloads only expanded folders", async () => {
  const slow = deferred();
  const calls = [];
  let folderCalls = 0;
  const model = new ReaderModel((_operation, path) => {
    calls.push(path);
    if (!path) return Promise.resolve(listing([entry("folder", true), entry("unopened", true)]));
    return ++folderCalls === 1 ? slow.promise : Promise.resolve(listing([entry("folder/fresh.md")]));
  });
  await model.list("");
  const expanding = model.toggleFolder("folder");
  await Promise.resolve();
  const refreshing = model.refreshTree();
  slow.reject(new Error("obsolete connection failure"));
  await Promise.all([expanding, refreshing]);
  assert.deepEqual(calls, ["", "folder", "", "folder"]);
  assert.equal(model.folders.get("folder").error, "");
  assert.equal(model.folders.get("folder").entries[0].path, "folder/fresh.md");
  assert.equal(model.refreshing, false);
});

test("collapsing during refresh does not reopen or request the collapsed branch", async () => {
  const rootRefresh = deferred();
  const calls = [];
  let roots = 0;
  const model = new ReaderModel((_operation, path) => {
    calls.push(path);
    return path === "" ? (++roots === 1 ? Promise.resolve(listing([entry("folder", true)])) : rootRefresh.promise) :
      Promise.resolve(listing([entry("folder/note.md")]));
  });
  await model.list(""); await model.toggleFolder("folder");
  const refreshing = model.refreshTree();
  await Promise.resolve();
  await model.toggleFolder("folder");
  rootRefresh.resolve(listing([entry("folder", true)])); await refreshing;
  assert.deepEqual(calls, ["", "folder", ""]);
  assert.equal(model.expanded.has("folder"), false);
  assert.deepEqual(model.visibleEntries.map((item) => item.path), ["folder"]);
});

test("refresh removes vanished expanded ancestors and their descendant caches", async () => {
  let rootCalls = 0;
  const model = new ReaderModel(async (_operation, path) => {
    if (!path) return listing(++rootCalls === 1 ? [entry("a", true)] : [entry("remaining.md")]);
    return listing(path === "a" ? [entry("a/b", true)] : [entry("a/b/note.md")]);
  });
  await model.list(""); await model.toggleFolder("a"); await model.toggleFolder("a/b");
  await model.refreshTree();
  assert.deepEqual([...model.expanded], []);
  assert.deepEqual([...model.folders.keys()], [""]);
  assert.deepEqual(model.visibleEntries.map((item) => item.path), ["remaining.md"]);
});

test("folder errors remain local and explicit retry restores that branch", async () => {
  let attempts = 0;
  const model = new ReaderModel(async (_operation, path) => {
    if (!path) return listing([entry("folder", true), entry("root.md")]);
    if (++attempts === 1) throw new Error("synthetic access denied");
    return listing([entry("folder/recovered.md")]);
  });
  await model.list(""); await model.toggleFolder("folder");
  assert.equal(model.tree().rows.find((row) => row.kind === "error").path, "folder");
  assert.equal(model.visibleEntries.at(-1).path, "root.md");
  await model.list("folder", true);
  assert.equal(model.tree().rows.some((row) => row.kind === "error"), false);
  assert.equal(model.visibleEntries[1].path, "folder/recovered.md");
});

test("tree cache and visible rows are bounded; collapsed caches yield space on retry", async () => {
  const calls = [];
  const model = new ReaderModel(async (_operation, path) => {
    calls.push(path);
    return path === "" ? listing([entry("a", true), entry("b", true)]) :
      listing(Array.from({ length: 1000 }, (_, index) => entry(`${path}/synthetic-${index}.md`)));
  });
  await model.list(""); await model.toggleFolder("a"); await model.toggleFolder("b");
  assert.equal(model.cachedEntries, TREE_MAX_ENTRIES);
  assert.equal(model.folders.get("b").limited, true);
  assert.equal(model.tree().rows.length, TREE_MAX_VISIBLE);
  assert.equal(model.tree().limited, true);
  assert.deepEqual(calls, ["", "a", "b"]);
  await model.toggleFolder("a"); await model.list("b", true);
  assert.equal(model.folders.has("a"), false);
  assert.equal(model.folders.get("b").entries.length, 1000);
  assert.equal(model.folders.get("b").limited, false);
  assert.ok(model.cachedEntries <= TREE_MAX_ENTRIES);
});

test("folder query budget requires a user collapse before another branch is loaded", async () => {
  const calls = [];
  const model = new ReaderModel(async (_operation, path) => {
    calls.push(path);
    return listing(path ? [] : Array.from({ length: TREE_MAX_FOLDERS + 1 }, (_, index) => entry(`folder-${index}`, true)));
  });
  await model.list("");
  for (let index = 0; index < TREE_MAX_FOLDERS; index += 1) await model.toggleFolder(`folder-${index}`);
  assert.equal(model.folders.size, TREE_MAX_FOLDERS);
  assert.equal(calls.length, TREE_MAX_FOLDERS);
  assert.equal(model.expanded.has(`folder-${TREE_MAX_FOLDERS - 1}`), false);
  assert.ok(model.treeNotice);
  await model.toggleFolder("folder-0");
  await model.toggleFolder(`folder-${TREE_MAX_FOLDERS - 1}`);
  assert.equal(model.folders.size, TREE_MAX_FOLDERS);
  assert.equal(calls.length, TREE_MAX_FOLDERS + 1);
  assert.equal(model.expanded.has(`folder-${TREE_MAX_FOLDERS - 1}`), true);
});

test("revealing a selected note loads only its ancestor chain", async () => {
  const calls = [];
  const model = new ReaderModel(async (operation, path) => {
    calls.push([operation, path]);
    if (operation === "read") return note("synthetic");
    return listing(path === "" ? [entry("a", true), entry("unrelated", true)] : path === "a" ? [entry("a/b", true)] : [entry("a/b/note.md")]);
  });
  await model.open("a/b/note.md");
  await model.reveal("a/b/note.md");
  assert.deepEqual(calls, [["read", "a/b/note.md"], ["files", ""], ["files", "a"], ["files", "a/b"]]);
  assert.deepEqual([...model.expanded], ["a", "a/b"]);
  assert.equal(model.visibleEntries[2].path, "a/b/note.md");
});

test("user collapse interrupts automatic ancestor reveal", async () => {
  const slow = deferred(), calls = [];
  const model = new ReaderModel((operation, path) => {
    calls.push([operation, path]);
    if (operation === "read") return Promise.resolve(note("synthetic"));
    return path === "" ? Promise.resolve(listing([entry("a", true)])) : slow.promise;
  });
  await model.open("a/b/note.md");
  const revealing = model.reveal("a/b/note.md");
  for (let tick = 0; tick < 5 && !model.expanded.has("a"); tick += 1) await Promise.resolve();
  assert.equal(model.expanded.has("a"), true);
  await model.toggleFolder("a");
  slow.resolve(listing([entry("a/b", true)])); await revealing;
  assert.equal(model.expanded.has("a"), false);
  assert.equal(calls.some(([, path]) => path === "a/b"), false);
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

const prefetched = (path, text = "synthetic", overrides = {}) => ({ path, text, revision: "a".repeat(64),
  bytes: text === null ? 3 : Buffer.byteLength(text), encoding: text === null ? "unsupported" : "utf-8", bom: false,
  line_endings: "none", final_newline: false, read_only: true, ...overrides });

test("a prefetched read replaces cached text without another RPC and invalidates older pending reads", async () => {
  for (const previousPath of ["Target.md", "Other.md"]) {
    const pending = deferred(), calls = [];
    const model = new ReaderModel((operation, path) => { calls.push([operation, path]); return pending.promise; });
    const old = model.open(previousPath, true);
    const latest = prefetched("Target.md", "# Fresh\r\n");
    model.documents.set("Target.md", prefetched("Target.md", "old cached text"));
    const previousSequence = model.readSequence;
    await model.open("Target.md", false, latest);
    assert.equal(model.readSequence, previousSequence + 1);
    assert.equal(model.selected, "Target.md");
    assert.equal(model.document, latest);
    assert.equal(model.readLoading, false);
    assert.equal(model.readError, "");
    pending.resolve(prefetched(previousPath, "obsolete")); await old;
    assert.equal(model.document, latest);
    assert.deepEqual(calls, [["read", previousPath]]);
  }
});

test("prefetched unsupported text=null is a valid document; absent document keeps the read fallback", async () => {
  const calls = [], model = new ReaderModel(async (operation, path) => { calls.push([operation, path]); return prefetched(path); });
  const unsupported = prefetched("Unsupported.md", null);
  await model.open("Unsupported.md", false, unsupported);
  assert.equal(model.document, unsupported);
  assert.equal(model.document.text, null);
  assert.deepEqual(calls, []);
  await model.open("Fallback.md", false, null);
  assert.deepEqual(calls, [["read", "Fallback.md"]]);
  assert.equal(model.document.path, "Fallback.md");
});

test("a mismatched prefetched document is rejected without caching or a fallback RPC", async () => {
  let calls = 0;
  const model = new ReaderModel(async () => { calls += 1; return prefetched("Target.md"); });
  await model.open("Target.md", false, prefetched("Other.md"));
  assert.equal(model.document, undefined);
  assert.match(model.readError, /잘못된 문서 읽기 응답/);
  assert.equal(calls, 0);
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

test("closing the reader invalidates an active tree query and never runs queued branches", async () => {
  const slow = deferred(), calls = [];
  const model = new ReaderModel((_operation, path) => {
    calls.push(path);
    return path ? slow.promise : Promise.resolve(listing([entry("a", true), entry("b", true)]));
  });
  await model.list("");
  const first = model.toggleFolder("a"), second = model.toggleFolder("b");
  await Promise.resolve();
  model.close();
  slow.resolve(listing([entry("a/late.md")]));
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["", "a"]);
  assert.equal(model.folders.size, 0);
  assert.equal(model.expanded.size, 0);
});

test("closed readers ignore pending folder and document work", async () => {
  const list = deferred(), read = deferred();
  const model = new ReaderModel((operation) => operation === "files" ? list.promise : read.promise);
  const listing = model.list("folder"), reading = model.open("folder/synthetic.md");
  model.close();
  list.resolve({ entries: [{ name: "stale.md" }], truncated: false });
  read.resolve(note("late text"));
  await Promise.all([listing, reading]);
  assert.equal(model.folders.size, 0);
  assert.deepEqual(model.tree().rows, []);
  assert.equal(model.document, undefined);
  await model.open("another.md");
  assert.equal(model.documents.size, 0);
});

const readerSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/vault-view.js", import.meta.url), "utf8");
const lifecycle = { pending: [], writes: [], released: 0, settingsClosed: 0, notifications: 0 };
globalThis.__herdrmdReaderLifecycle = lifecycle;
const editSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/edit-model.js", import.meta.url), "utf8");
const readerPrelude = `
import { EditModel } from "data:text/javascript;base64,${Buffer.from(editSource).toString("base64")}";
class EditTransport { async load() { return null; } }
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
  value() { return ""; }, on() {},
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
