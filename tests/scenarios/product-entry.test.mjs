import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const productEntry = new URL("../../integrations/herdr/mods/herdrmd/main.js", import.meta.url);
const source = await readFile(productEntry, "utf8");
const calls = { options: null, constructed: [], rendered: [], closed: [] };
globalThis.__herdrmdEntryTest = calls;
const prelude = `
const state = globalThis.__herdrmdEntryTest;
class View {}
const props = () => state.options;
class VaultReader {
  constructor(options, cx) { this.options = options; state.constructed.push({ options, cx }); }
  render(cx) { state.rendered.push({ reader: this, cx }); return "reader content"; }
  close() { state.closed.push(this); }
}
`;
const { default: Herdrmd } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source.replace(/^import .*;\n/gm, "")).toString("base64")}`);
delete globalThis.__herdrmdEntryTest;

test("the product entry always constructs the Vault reader, including absent or legacy mode", () => {
  for (const options of [undefined, {}, { mode: "probe" }, { mode: "vault", vault: "work", binary: "/opt/herdrmd" }]) {
    calls.options = options;
    const entry = new Herdrmd(), cx = {};
    entry.init({}, cx);
    assert.deepEqual(calls.constructed.at(-1), { options: options || {}, cx });
    assert.equal(entry.render(cx), "reader content");
    assert.equal(calls.rendered.at(-1).reader, entry.reader);
    entry.close(cx);
    assert.equal(calls.closed.at(-1), entry.reader);
  }
});

test("the product module graph contains no bridge diagnostic imports or fallback", async () => {
  const productRoot = dirname(fileURLToPath(productEntry)), visited = new Set();
  const visit = async (path) => {
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(path.startsWith(productRoot + sep), `Product imports outside its module: ${path}`);
    assert.notEqual(path.split(sep).at(-1), "api.js");
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /BridgeProbe|\/v1\/probe|auth_rejection_observed|bridge-[`$]/);
    for (const match of text.matchAll(/^import[^\n]*from\s+["']([^"']+)["']/gm)) {
      if (match[1].startsWith(".")) await visit(resolve(dirname(path), match[1]));
    }
  };
  await visit(fileURLToPath(productEntry));
  assert.ok(visited.has(resolve(productRoot, "vault-view.js")));
  assert.doesNotMatch(source, /options\.mode|connect|\.\/api\.js/);
});

test("reader command entry points exclude test selectors while retaining product actions", async () => {
  const reader = await readFile(new URL("./vault-view.js", productEntry), "utf8");
  for (const selector of ["follow-link-", "choose-link-", "read-first-note", "open-entry-"])
    assert.equal(reader.includes(selector), false, selector);
  for (const command of ["refresh", "settings", "settings-close", "collapse-all", "properties", "browse", "source", "preview", "dismiss-link"])
    assert.ok(reader.includes(`command === "${command}"`), command);
  for (const method of ["followLink", "chooseLink", "selectEntry"])
    assert.match(reader, new RegExp(`  ${method}\\(`));
});

test("the synthetic bridge probe remains a separate mod using only the diagnostics binary", async () => {
  const folder = new URL("../../integrations/herdr/diagnostics/herdrmd-probe/", import.meta.url);
  const [main, api, manifest] = await Promise.all([readFile(new URL("main.js", folder), "utf8"),
    readFile(new URL("api.js", folder), "utf8"), readFile(new URL("mod.json", folder), "utf8")]);
  assert.match(main, /import \{ connect \} from "\.\/api\.js"/);
  assert.match(main, /mods\/herdrmd-probe\/herdrmd-diagnostics/);
  assert.doesNotMatch(main, /VaultReader|vault-view\.js|options\.mode/);
  assert.match(api, /authentication probe failed/);
  assert.equal(JSON.parse(manifest).place, "none");
});
