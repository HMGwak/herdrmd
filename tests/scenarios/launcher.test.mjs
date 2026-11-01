import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const source = await readFile(new URL("../../integrations/herdr/mods/herdrmd-new-menu/launcher.js", import.meta.url), "utf8");
const { parseTarget, launchArguments } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("remote target stays on its selected host regardless of the active space", () => {
  const target = parseTarget(JSON.stringify({
    name: "NAS personal", machine: "nas-test", binary: "/opt/herdrmd/bin/herdrmd",
    vault: "personal", file: "folder/note.md", token: "never copy unrelated settings",
  }));
  assert.deepEqual(launchArguments(target, "windows-space"), {
    name: "NAS personal", space: "windows-space", mod: "herdrmd",
    props: { mode: "vault", label: "NAS personal", machine: "nas-test", binary: "/opt/herdrmd/bin/herdrmd", vault: "personal", file: "folder/note.md" },
  });
});

test("local target does not inherit the current remote space's machine", () => {
  const target = parseTarget(JSON.stringify({ name: "Local", binary: "C:\\Tools\\herdrmd.exe", vault: "personal" }));
  assert.equal(launchArguments(target, "remote-space").props.machine, undefined);
  assert.equal(launchArguments(target).space, undefined);
});

test("missing or invalid launch settings cannot silently select another Vault", () => {
  for (const value of ["null", "{}", "not JSON",
    JSON.stringify({ name: "X", binary: "relative/herdrmd", vault: "personal" }),
    JSON.stringify({ name: "X", binary: "/bin/herdrmd", vault: "personal", machine: "" }),
    JSON.stringify({ name: "X", binary: "/bin/herdrmd", vault: "personal", file: "../private.md" }),
  ]) assert.throws(() => parseTarget(value));
});
