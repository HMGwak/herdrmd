import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("../../integrations/herdr/mods/herdrmd/wikilinks.js", import.meta.url), "utf8");
const navigationRawSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/wiki-navigation.js", import.meta.url), "utf8");
const readerModelSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/reader-model.js", import.meta.url), "utf8");
const { ReaderModel } = await import(moduleUrl(readerModelSource));
const navigationSource = navigationRawSource.replace('from "./reader-model.js"', `from "${moduleUrl(readerModelSource)}"`);
const frontmatterSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/frontmatter.js", import.meta.url), "utf8");
const { renderWikilinks } = await import(moduleUrl(source));
const { WikiNavigation } = await import(moduleUrl(navigationSource));
const { splitFrontmatter } = await import(moduleUrl(frontmatterSource));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const from = () => ({ path: "folder/source.md", document: {}, generation: 1 });
const same = (source) => (candidate) => candidate === source;
const readDocument = (path, text = "synthetic", overrides = {}) => ({ path, text, revision: "a".repeat(64),
  bytes: text === null ? 3 : Buffer.byteLength(text), encoding: text === null ? "unsupported" : "utf-8", bom: false,
  line_endings: "none", final_newline: false, read_only: true, ...overrides });
const found = (path, fragment = null) => ({ status: "found", matches: [path], fragment, truncated: false });

test("wiki targets and aliases become table-bound private links without interpreting paths", () => {
  const raw = "[[노트 이름]] / [[folder/Note#Heading|표시 이름]] / [[#^block]]";
  const preview = renderWikilinks(raw, "synthetic-1");
  assert.deepEqual(preview.links.map(({ target, label }) => [target, label]), [["노트 이름", "노트 이름"], ["folder/Note#Heading", "표시 이름"], ["#^block", "#^block"]]);
  assert.equal(preview.links[0].url, "herdrmd-wiki://resolve/synthetic-1/1");
  assert.equal(preview.byUrl.get(preview.links[1].url).target, "folder/Note#Heading");
  assert.equal(preview.byUrl.has("herdrmd-wiki://resolve/forged/1"), false);
  assert.equal(preview.markdown.includes("[["), false);
  assert.equal(raw, "[[노트 이름]] / [[folder/Note#Heading|표시 이름]] / [[#^block]]");
});

test("inline code spans, including multiline and unequal backtick runs, stay exact", () => {
  const raw = "`[[hidden]]` and ``[[hidden ` too]]``\n`code\n[[hidden multiline]]` then [[visible]]";
  const preview = renderWikilinks(raw);
  assert.deepEqual(preview.links.map(({ target }) => target), ["visible"]);
  assert.equal(preview.markdown.slice(0, raw.indexOf("[[visible]]")), raw.slice(0, raw.indexOf("[[visible]]")));
  assert.equal(renderWikilinks("unmatched ` then [[visible]]").links.length, 1);
});

test("backtick/tilde fences and unclosed fences are retained byte for byte", () => {
  const raw = "before\r\n```md\r\n[[inside]]\r\n```\r\n~~~\n[[tilde]]\n~~~\n> ````\n> [[quoted]]\n> ```\n> ````\n[[visible]]\n```\n[[unfinished]]";
  const preview = renderWikilinks(raw);
  assert.deepEqual(preview.links.map(({ target }) => target), ["visible"]);
  assert.ok(preview.markdown.startsWith(raw.slice(0, raw.indexOf("[[visible]]"))));
  assert.ok(preview.markdown.endsWith("\n```\n[[unfinished]]"));
});

test("escaped openers, embeds, and indented code are left as source syntax", () => {
  const raw = String.raw`\[[escaped]] ![[embedded]] ![[folder/note#part|alias]] \\[[visible]]` + "\n    [[indented]]\n\t[[tabbed]]\n";
  const preview = renderWikilinks(raw);
  assert.deepEqual(preview.links.map(({ target }) => target), ["visible"]);
  assert.ok(preview.markdown.startsWith(String.raw`\[[escaped]] ![[embedded]] ![[folder/note#part|alias]] \\`));
  assert.ok(preview.markdown.endsWith("\n    [[indented]]\n\t[[tabbed]]\n"));
});

test("clear nested list items inherit their list context while indented examples remain code", () => {
  const raw = "- parent\n    - [[Nested]]\n        1. [[Deep ordered]]\n    2. [[Ordered child]]\n\nparagraph\n\n    - [[standalone code]]\n\n- another parent\n        - [[deep code]]\n";
  const preview = renderWikilinks(raw);
  assert.deepEqual(preview.links.map(({ target }) => target), ["Nested", "Deep ordered", "Ordered child"]);
  assert.ok(preview.markdown.includes("    - [[standalone code]]"));
  assert.ok(preview.markdown.includes("        - [[deep code]]"));
  const ordered = renderWikilinks("1. parent\n    1. [[Ordered nested]]\n    - [[Bullet nested]]\n");
  assert.deepEqual(ordered.links.map(({ target }) => target), ["Ordered nested", "Bullet nested"]);
});

test("alias punctuation cannot inject links, images, HTML, or formatting", () => {
  const preview = renderWikilinks('[[Safe|x](https://evil.test) ![img](https://evil.test) <img src=x> `code` &amp; **bold**]]');
  assert.equal(preview.links.length, 1);
  assert.equal(preview.links[0].target, "Safe");
  assert.equal(preview.markdown.match(/\]\(/g).length, 1);
  assert.ok(preview.markdown.includes('\\<img src\\=x\\>'));
  assert.ok(preview.markdown.includes('\\`code\\`'));
  assert.ok(preview.markdown.includes('\\&amp\\;'));
  assert.ok(preview.markdown.includes('\\*\\*bold\\*\\*'));
  assert.equal(preview.markdown.includes("https://evil.test"), false);
});

test("comments, HTML attributes, raw code, empty and multiline wiki syntax stay literal", () => {
  const raw = '<!-- [[comment]] --> <span data-note="[[attribute]]">[[visible]]</span> <code>[[raw code]]</code> <pre>[[pre]]</pre> [[]] [[ ]] [[multi\nline]]';
  const preview = renderWikilinks(raw);
  assert.deepEqual(preview.links.map(({ target }) => target), ["visible"]);
  assert.ok(preview.markdown.includes('data-note="[[attribute]]"'));
  assert.ok(preview.markdown.includes('<code>[[raw code]]</code>'));
  assert.ok(preview.markdown.endsWith('[[]] [[ ]] [[multi\nline]]'));
});

test("frontmatter is split before adaptation and the full original source remains untouched", () => {
  const raw = '---\r\naliases: "[[metadata only]]"\r\n---\r\n# Heading\r\n[[body note]]\r\n';
  const metadata = splitFrontmatter(raw), preview = renderWikilinks(metadata.body);
  assert.deepEqual(preview.links.map(({ target }) => target), ["body note"]);
  assert.equal(metadata.raw, 'aliases: "[[metadata only]]"\r\n');
  assert.equal(metadata.body, '# Heading\r\n[[body note]]\r\n');
  assert.equal(raw, '---\r\naliases: "[[metadata only]]"\r\n---\r\n# Heading\r\n[[body note]]\r\n');
});

test("a unique complete resolver result returns one open action and its fragment", async () => {
  const navigation = new WikiNavigation(), source = from();
  const action = await navigation.follow("Target#Heading", source, async (path, target) => {
    assert.equal(path, source.path); assert.equal(target, "Target#Heading");
    return found("other/Target.md", "Heading");
  }, same(source));
  assert.equal(action.path, "other/Target.md");
  assert.equal(action.fragment, "Heading");
  assert.equal(navigation.state, null);
  assert.equal(navigation.current(action, same(source)), true);
  navigation.cancel();
  assert.equal(navigation.current(action, same(source)), false);
});

test("created is carried only by a complete found result, never by an incomplete candidate", async () => {
  const navigation = new WikiNavigation(), source = from();
  const action = await navigation.follow("New", source, async () => ({ ...found("New.md"), created: true }), same(source));
  assert.equal(action.created, true);
  await navigation.follow("Partial", source, async () => ({ status: "incomplete", matches: ["Partial.md"], fragment: null, truncated: true, created: true }), same(source));
  assert.equal(navigation.choose(0, same(source)).created, false);
});

test("complete found actions accept only a matching, fully shaped prefetched read document", async () => {
  const navigation = new WikiNavigation(), source = from();
  for (const text of ["# Synthetic\r\n", null]) {
    const document = readDocument("Target.md", text);
    const action = await navigation.follow("Target", source, async () => ({ ...found("Target.md"), document }), same(source));
    assert.equal(action.document, document);
  }
  for (const document of [readDocument("Wrong.md"), readDocument("Target.md", "body", { revision: "" }),
    readDocument("Target.md", "body", { bytes: -1 }), readDocument("Target.md", "body", { read_only: "false" }),
    readDocument("Target.md", null, { encoding: "utf-8" }), { path: "Target.md", text: "incomplete shape" }]) {
    const action = await navigation.follow("Target", source, async () => ({ ...found("Target.md"), document }), same(source));
    assert.equal(action, null);
    assert.equal(navigation.state.kind, "message");
    assert.match(navigation.state.message, /잘못된 문서 읽기 응답/);
  }
});

test("ambiguous results require explicit path selection and cannot choose stale choices", async () => {
  const navigation = new WikiNavigation(), source = from();
  const action = await navigation.follow("Same", source, async () => ({ status: "ambiguous", matches: ["a/Same.md", "b/Same.md"], fragment: "^block", truncated: false }), same(source));
  assert.equal(action, null);
  assert.equal(navigation.state.kind, "ambiguous");
  assert.deepEqual(navigation.state.matches, ["a/Same.md", "b/Same.md"]);
  assert.equal(navigation.choose(1, same(source)).path, "b/Same.md");
  assert.equal(navigation.choose(1, same(source)).fragment, "^block");
  assert.equal(navigation.choose(2, same(source)), null);
  assert.equal(navigation.choose(0, () => false), null);
  navigation.cancel();
  assert.equal(navigation.choose(0, same(source)), null);
});

test("choice lists are bounded only when there are more than fifty actual matches", async () => {
  const navigation = new WikiNavigation(), source = from();
  await navigation.follow("Same", source, async () => ({ status: "ambiguous", matches: Array.from({ length: 100 }, (_, index) => `${index}/Same.md`), fragment: null, truncated: false }), same(source));
  assert.equal(navigation.state.matches.length, 50);
  assert.equal(navigation.state.limited, true);
  await navigation.follow("Same", source, async () => ({ status: "ambiguous", matches: ["a/Same.md", "b/Same.md"], fragment: null, truncated: true }), same(source));
  assert.equal(navigation.state.limited, false);
});

test("partial results never open automatically but allow explicit selection of found paths", async () => {
  const navigation = new WikiNavigation(), source = from();
  for (const result of [
    { status: "incomplete", matches: ["Partial.md"], fragment: "^block", truncated: true },
    { status: "incomplete", matches: ["Partial.md"], fragment: "^block", truncated: false },
    { status: "found", matches: ["Partial.md"], fragment: "^block", truncated: true },
  ]) {
    const action = await navigation.follow("Partial", source, async () => result, same(source));
    assert.equal(action, null);
    assert.equal(navigation.state.kind, "ambiguous");
    assert.equal(navigation.state.limited, false);
    assert.match(navigation.state.message, /전체.*조회하지 못/);
    assert.equal(navigation.choose(0, same(source)).path, "Partial.md");
    assert.equal(navigation.choose(0, same(source)).fragment, "^block");
    assert.equal(navigation.choose(0, () => false), null);
    navigation.cancel();
    assert.equal(navigation.choose(0, same(source)), null);
  }
});

test("partial searches with no candidate explain incomplete coverage and path or permission checks", async () => {
  const navigation = new WikiNavigation(), source = from();
  const action = await navigation.follow("Unknown", source, async () => ({ status: "incomplete", matches: [], fragment: null, truncated: true }), same(source));
  assert.equal(action, null);
  assert.equal(navigation.state.kind, "message");
  assert.match(navigation.state.message, /전체.*조회하지 못/);
  assert.match(navigation.state.message, /경로.*권한/);
  assert.equal(navigation.choose(0, same(source)), null);
});

test("missing, inconsistent, and failed responses provide messages without an open action", async () => {
  const navigation = new WikiNavigation(), source = from();
  for (const result of [{ status: "not_found", matches: [], fragment: null, truncated: false },
    { status: "found", matches: [], fragment: null, truncated: false },
    { status: "found", matches: [42], fragment: null, truncated: false }]) {
    assert.equal(await navigation.follow("Target", source, async () => result, same(source)), null);
    assert.equal(navigation.state.kind, "message");
  }
  assert.equal(await navigation.follow("Target", source, async () => { throw new Error("synthetic disconnect"); }, same(source)), null);
  assert.match(navigation.state.message, /synthetic disconnect/);
});

test("a later link selection wins over earlier successes and failures", async () => {
  const navigation = new WikiNavigation(), source = from(), first = deferred(), second = deferred();
  const old = navigation.follow("Old", source, () => first.promise, same(source));
  const current = navigation.follow("Current", source, () => second.promise, same(source));
  second.resolve({ status: "ambiguous", matches: ["a/Current.md", "b/Current.md"], fragment: null, truncated: false });
  await current;
  first.reject(new Error("obsolete failure")); await old;
  assert.equal(navigation.state.kind, "ambiguous");
  assert.equal(navigation.state.target, "Current");
  const stale = deferred(), pending = navigation.follow("OldAgain", source, () => stale.promise, same(source));
  await navigation.follow("Newest", source, async () => found("Newest.md"), same(source));
  stale.resolve(found("OldAgain.md"));
  assert.equal(await pending, null);
  assert.equal(navigation.state, null);
});

test("document switch, refresh generation, and close invalidate pending navigation", async () => {
  for (const change of ["switch", "refresh", "close"]) {
    const navigation = new WikiNavigation(), source = from(), pending = deferred();
    let current = source;
    const isCurrent = (candidate) => candidate === current;
    const following = navigation.follow("Target", source, () => pending.promise, isCurrent);
    if (change === "close") navigation.close();
    else current = { ...source, generation: source.generation + 1, ...(change === "switch" ? { path: "different.md" } : {}) };
    pending.resolve({ ...found("Target.md"), document: readDocument("Target.md") });
    assert.equal(await following, null);
    assert.equal(navigation.state, null);
  }
});

const readerSource = await readFile(new URL("../../integrations/herdr/mods/herdrmd/vault-view.js", import.meta.url), "utf8");
const integration = { exec: null };
globalThis.__herdrmdWikiTest = integration;
const checkboxSource = (await readFile(new URL("../../integrations/herdr/mods/herdrmd/checkboxes.js", import.meta.url), "utf8"))
  .replace("from './wikilinks.js'", `from '${moduleUrl(source)}'`).replace("from './frontmatter.js'", `from '${moduleUrl(frontmatterSource)}'`);
const readerPrelude = `
import { renderCheckboxes, renderCheckboxesSteps, toggleCheckbox } from "${moduleUrl(checkboxSource)}";
import { renderWikilinks, renderWikilinksSteps } from "${moduleUrl(source)}";
import { WikiNavigation } from "${moduleUrl(navigationSource)}";
import { splitFrontmatter } from "${moduleUrl(frontmatterSource)}";
import { parentPath } from "${moduleUrl(readerModelSource)}";
const state = globalThis.__herdrmdWikiTest;
const exec = (...args) => state.exec(...args);
`;
const { VaultReader } = await import(moduleUrl(readerPrelude + readerSource.replace(/^import .*;\n/gm, "")));
delete globalThis.__herdrmdWikiTest;
// These navigation-only harnesses do not exercise native editor or local storage.
VaultReader.prototype.edits = { states: new Map(), flush: async () => {}, attach: async document => ({ document, text: document.text }) };
VaultReader.prototype.editorReadonly = true;

const readerHarness = () => {
  const reader = Object.create(VaultReader.prototype), tasks = [], opened = [], external = [];
  const document = { text: '---\nalias: "[[not a link]]"\n---\n[[Target#Heading|표시]]\n' };
  Object.assign(reader, { options: { binary: "/opt/herdrmd", machine: "synthetic-nas" }, vault: "test-vault",
    model: { selected: "folder/source.md", document, readSequence: 7 }, previewMetadata: new WeakMap(), previewLinks: new WeakMap(),
    previewSequence: 0, wikiScope: "synthetic", closed: false, notice: "" });
  reader.action = (cx, operation) => { tasks.push(operation(cx)); };
  reader.open = (path, _cx, { notice = "" } = {}) => { reader.wikiNavigation?.cancel(); reader.notice = notice; opened.push(path); };
  const cx = { notify() {}, open_url(url) { external.push(url); } };
  return { reader, tasks, opened, external, cx, document };
};

test("reader follows a link with exact from/target arguments on the configured NAS", async () => {
  const { reader, tasks, opened, cx, document } = readerHarness(), calls = [];
  const raw = document.text;
  integration.exec = async (...args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ resolution: found("notes/Target.md", "Heading"), document: null }) }; };
  reader.followLink(0, cx);
  await Promise.all(tasks);
  assert.deepEqual(calls, [["/opt/herdrmd", ["follow-read", "--vault", "test-vault", "--from", "folder/source.md", "--target", "Target#Heading"], { on: "synthetic-nas" }]]);
  assert.deepEqual(opened, ["notes/Target.md"]);
  assert.match(reader.notice, /제목·블록/);
  assert.equal(document.text, raw);
  assert.equal(reader.previewFor(document).links.length, 1);
});

test("native preview callbacks resolve only table links; HTTP and stale callbacks stay separate", async () => {
  const { reader, tasks, opened, external, cx, document } = readerHarness(), calls = [];
  integration.exec = async (...args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ resolution: found("Target.md"), document: null }) }; };
  reader.previewLink("herdrmd-wiki://resolve/forged/1", document, reader.model.selected, cx);
  reader.previewLink("https://example.test/reference", document, reader.model.selected, cx);
  reader.previewLink(reader.previewFor(document).links[0].url, {}, reader.model.selected, cx);
  assert.deepEqual(calls, []);
  assert.deepEqual(external, ["https://example.test/reference"]);
  reader.previewLink(reader.previewFor(document).links[0].url, document, reader.model.selected, cx);
  await Promise.all(tasks);
  assert.equal(calls.length, 1);
  assert.deepEqual(opened, ["Target.md"]);
});


test("fragment feedback is present before the first spawned loading frame and survives document completion", async () => {
  const reader = Object.create(VaultReader.prototype), pending = deferred(), tasks = [], frames = [];
  const sourceDocument = { text: "[[folder/Target#Heading]]", bytes: 26, encoding: "utf-8", line_endings: "lf", bom: false };
  const targetDocument = { text: "# Heading\nSynthetic only", bytes: 24, encoding: "utf-8", line_endings: "lf", bom: false };
  const model = new ReaderModel(async (operation, path) => operation === "files" ? { entries: [], truncated: false } : path === "Source.md" ? sourceDocument : pending.promise);
  await model.open("Source.md");
  Object.assign(reader, { model, closed: false, notice: "", editor: { set_value() {}, value() { return ""; } }, wikiNavigation: new WikiNavigation() });
  const source = { path: model.selected, document: model.document, generation: model.readSequence };
  await reader.wikiNavigation.follow("folder/Target#Heading", source, async () => ({ status: "incomplete", matches: ["folder/Target.md"], fragment: "Heading", truncated: true }), (candidate) => reader.currentLinkSource(candidate));
  const cx = {
    // Native tasks can publish loading state immediately when spawn is called.
    spawn(handler) { tasks.push(handler(cx)); },
    notify() { frames.push({ path: model.selected, notice: reader.notice }); },
  };
  reader.chooseLink(0, cx);
  assert.equal(model.selected, "folder/Target.md");
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => /위치 이동은 준비 중/.test(frame.notice)));
  pending.resolve(targetDocument);
  await Promise.all(tasks);
  assert.deepEqual(model.document, targetDocument);
  assert.match(reader.notice, /위치 이동은 준비 중/);
  assert.ok(frames.every((frame) => /위치 이동은 준비 중/.test(frame.notice)));
  reader.open("Source.md", cx);
  assert.equal(reader.notice, "");
  await Promise.all(tasks);
});


test("a created document replaces stale text and appears in expanded or previously collapsed folder caches", async () => {
  for (const expanded of [false, true]) {
    const reader = Object.create(VaultReader.prototype), tasks = [], listCalls = [], readCalls = [], execCalls = [];
    let created = false;
    const sourceDocument = { text: "[[folder/New note]]", bytes: 19, encoding: "utf-8", line_endings: "lf", bom: false };
    const blankDocument = readDocument("folder/New note.md", "");
    const folderEntry = { name: "folder", path: "folder", directory: true };
    const sourceEntry = { name: "Source.md", path: "folder/Source.md", directory: false };
    const newEntry = { name: "New note.md", path: "folder/New note.md", directory: false };
    const model = new ReaderModel(async (operation, path) => {
      if (operation === "files") {
        listCalls.push(path);
        return { entries: path === "" ? [folderEntry] : [sourceEntry, ...(created ? [newEntry] : [])], truncated: false };
      }
      readCalls.push(path);
      return path === sourceEntry.path ? sourceDocument : blankDocument;
    });
    await model.list(""); await model.toggleFolder("folder"); await model.open(sourceEntry.path);
    if (!expanded) await model.toggleFolder("folder");
    // The same path could have been read before another program removed the file.
    model.documents.set(newEntry.path, { ...blankDocument, text: "stale deleted text" });
    Object.assign(reader, { model, options: { binary: "/opt/herdrmd", machine: "synthetic-nas" }, vault: "test-vault",
      previewMetadata: new WeakMap(), previewLinks: new WeakMap(), previewSequence: 0, wikiScope: "synthetic-create",
      closed: false, notice: "", editor: { set_value() {}, value() { return ""; } } });
    integration.exec = async (...args) => {
      execCalls.push(args); created = true;
      return { code: 0, stdout: JSON.stringify({ resolution: { ...found(newEntry.path), created: true }, document: blankDocument }) };
    };
    const cx = { spawn(handler) { tasks.push(handler(cx)); }, notify() {} };
    reader.followLink(0, cx);
    let drained = 0;
    while (drained < tasks.length) { const batch = tasks.slice(drained); drained = tasks.length; await Promise.all(batch); }
    assert.deepEqual(execCalls, [["/opt/herdrmd", ["follow-read", "--vault", "test-vault", "--from", sourceEntry.path, "--target", "folder/New note"], { on: "synthetic-nas" }]]);
    assert.equal(model.selected, newEntry.path);
    assert.deepEqual(model.document, blankDocument);
    assert.equal(model.document.text, "");
    assert.deepEqual(readCalls, [sourceEntry.path]);
    assert.deepEqual(listCalls, ["", "folder", "", "folder"]);
    assert.ok(model.visibleEntries.some((entry) => entry.path === newEntry.path));
    assert.match(reader.notice, /빈 문서.*만들었습니다/);
  }
});


test("a normal prefetched follow uses one RPC, while null or omitted documents retain the read fallback", async () => {
  for (const mode of ["prefetched", "unsupported", "null", "omitted"]) {
    const reader = Object.create(VaultReader.prototype), tasks = [], requests = [], execCalls = [];
    const sourcePath = "folder/Source.md", targetPath = "folder/Target.md";
    const document = readDocument(targetPath, mode === "unsupported" ? null : "# Target\r\n");
    const model = new ReaderModel(async (operation, path) => {
      requests.push([operation, path]);
      if (operation === "files") return { entries: path === "" ? [{ name: "folder", path: "folder", directory: true }] :
        [sourcePath, targetPath].map((path) => ({ name: path.split("/").pop(), path, directory: false })), truncated: false };
      return path === sourcePath ? readDocument(sourcePath, "[[folder/Target]]") : document;
    });
    await model.list(""); await model.toggleFolder("folder"); await model.open(sourcePath);
    requests.length = 0;
    Object.assign(reader, { model, options: { binary: "/opt/herdrmd", machine: "synthetic-nas" }, vault: "test-vault",
      previewMetadata: new WeakMap(), previewLinks: new WeakMap(), previewSequence: 0, wikiScope: "synthetic-prefetch",
      closed: false, notice: "", editor: { set_value() {}, value() { return ""; } } });
    integration.exec = async (...args) => {
      execCalls.push(args);
      const payload = { resolution: found(targetPath) };
      if (mode !== "omitted") payload.document = mode === "null" ? null : document;
      return { code: 0, stdout: JSON.stringify(payload) };
    };
    const cx = { spawn(handler) { tasks.push(handler(cx)); }, notify() {} };
    reader.followLink(0, cx);
    let drained = 0;
    while (drained < tasks.length) { const batch = tasks.slice(drained); drained = tasks.length; await Promise.all(batch); }
    assert.equal(execCalls.length, 1);
    assert.deepEqual(execCalls[0], ["/opt/herdrmd", ["follow-read", "--vault", "test-vault", "--from", sourcePath, "--target", "folder/Target"], { on: "synthetic-nas" }]);
    assert.equal(model.selected, targetPath);
    assert.deepEqual(model.document, document);
    assert.deepEqual(requests, mode === "null" || mode === "omitted" ? [["read", targetPath]] : []);
    assert.equal(model.readError, "");
  }
});

test("delayed link resolution uses the spawned context after the click context expires", async () => {
  const { reader, opened } = readerHarness(), pending = deferred(), tasks = [];
  let valid = true, notifications = 0;
  const asyncCx = { notify() { notifications++; }, spawn(handler) { tasks.push(handler(asyncCx)); } };
  const clickCx = {
    notify() { assert.ok(valid, "expired click context used for notify"); },
    spawn(handler) { assert.ok(valid, "expired click context used for spawn"); tasks.push(handler(asyncCx)); },
  };
  reader.action = VaultReader.prototype.action;
  reader.syncEditor = () => {};
  reader.open = (path, cx) => { cx.notify(); cx.spawn(async () => opened.push(path)); };
  integration.exec = () => pending.promise;
  reader.followLink(0, clickCx);
  valid = false;
  pending.resolve({ code: 0, stdout: JSON.stringify({ resolution: found("Target.md"), document: null }) });
  let drained = 0;
  while (drained < tasks.length) { const batch = tasks.slice(drained); drained = tasks.length; await Promise.all(batch); }
  assert.deepEqual(opened, ["Target.md"]);
  assert.doesNotMatch(reader.notice, /expired|context|TypeError/);
  assert.ok(notifications > 0);
});


test("long prose, long targets and many lines preserve all non-link text", () => {
  const prose = "한글 prose and punctuation. ".repeat(40000);
  const lines = "ordinary paragraph\r\n".repeat(20000);
  const target = "긴 이름".repeat(10000);
  const raw = prose + "[[Target]]\n" + lines + "[[" + target + "]]\n```md\n[[hidden]]\n```\n";
  const preview = renderWikilinks(raw, "large");
  assert.deepEqual(preview.links.map(link => link.target), ["Target", target]);
  assert.equal(preview.markdown, prose + "[Target](herdrmd-wiki://resolve/large/1)\n" + lines
    + "[" + target + "](herdrmd-wiki://resolve/large/2)\n```md\n[[hidden]]\n```\n");
});

test("preview preparation yields to the host and drops results after navigation", async () => {
  for (const navigate of [false, true]) {
    const { reader, document } = readerHarness(), tasks = [];
    document.text = "paragraph\n".repeat(1000) + "- [ ] task\n[[Target]]";
    let pauses = 0, notifications = 0;
    const cx = {
      spawn(fn) { tasks.push(fn(cx)); },
      async sleep() { pauses++; if (navigate && pauses === 4) reader.model.document = {}; },
      notify() { notifications++; },
    };
    reader.preparePreview(document, cx);
    reader.preparePreview(document, cx);
    assert.equal(tasks.length, 1);
    assert.equal(reader.previewLinks.has(document), false);
    await Promise.all(tasks);
    assert.ok(pauses >= 4);
    assert.equal(reader.previewLinks.has(document), !navigate);
    assert.equal(reader.previewJobs.has(document), false);
    assert.equal(notifications, 1);
    if (!navigate) {
      const preview = reader.previewLinks.get(document);
      assert.equal(preview.links[0].target, "Target");
      assert.equal(preview.checks.size, 1);
      assert.equal(preview.markdown.startsWith("paragraph\n".repeat(1000)), true);
    }
  }
});
