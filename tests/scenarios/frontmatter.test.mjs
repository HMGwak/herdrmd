import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
const source = await readFile(new URL("../../integrations/herdr/mods/herdrmd/frontmatter.js", import.meta.url), "utf8");
const { splitFrontmatter, propertyLabel, frontmatterSummary } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("top frontmatter becomes properties while the exact Markdown body remains intact", () => {
  const raw = 'title: "한글 문서"\r\nstatus: active\r\ntags:\r\n  - note\r\n  - "한글 태그"\r\n';
  const body = '\r\n# 본문\r\n\r\n---\r\n[[원문 링크]]\r\n';
  const text = '\uFEFF---\r\n' + raw + '---\r\n' + body;
  const result = splitFrontmatter(text);
  assert.equal(result.raw, raw); assert.equal(result.body, body);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.properties.map(p => p.key), ['title','status','tags']);
  assert.equal(propertyLabel(result.properties[0].value), '한글 문서');
  assert.equal(propertyLabel(result.properties[2].value), 'note · 한글 태그');
  assert.match(frontmatterSummary(result), /status: active.*tags:/);
});

test("body rules, fenced YAML examples and unclosed or indented markers are not stripped", () => {
  for (const text of ['# Note\n---\ntext\n', '```yaml\n---\nkey: value\n---\n```',
    '---\nkey: value\n# no closing fence', '\n---\nkey: value\n---\n', ' ---\nkey: value\n---\n',
    '----\nkey: value\n---\n']) assert.equal(splitFrontmatter(text), null);
});

test("bare CR, empty metadata and closing marker at EOF preserve boundaries", () => {
  assert.equal(splitFrontmatter('---\rkey: value\r---\r# Body\r').body, '# Body\r');
  assert.deepEqual(splitFrontmatter('---\n---').properties, []);
  assert.equal(splitFrontmatter('---\n---').body, '');
  assert.equal(splitFrontmatter('---\nkey: value\n---').properties[0].value, 'value');
});

test("nested mappings and literal scalars stay literal; unsupported YAML stays available", () => {
  const result = splitFrontmatter('---\nsummary: |-\n  line one\n  line two\nobject:\n  child: true\n---\nbody');
  assert.equal(result.properties[0].value, '|-\n  line one\n  line two');
  assert.equal(result.properties[1].value, 'child: true');
  for (const raw of ['"quoted key": value\n', '- list document\n', 'key:without-space\n', '# only comment\n']) {
    const result = splitFrontmatter('---\n'+raw+'---\nbody');
    assert.equal(result.fallback, true); assert.equal(result.raw, raw); assert.equal(result.body, 'body');
  }
});

test("property labels are display text and never evaluate YAML tags or objects", () => {
  assert.equal(propertyLabel('["alpha", "beta", 3, false]'), 'alpha · beta · 3 · false');
  assert.equal(propertyLabel("'It''s literal'"), "It's literal");
  assert.equal(propertyLabel('!!js/function function() {}'), '!!js/function function() {}');
  assert.equal(propertyLabel('[{ "nested": true }]'), '[{ "nested": true }]');
  assert.equal(propertyLabel(''), '—');
  const indentless = splitFrontmatter('---\ntags:\n- alpha\n- beta\nstatus: active\n---\nbody');
  assert.equal(indentless.fallback, false);
  assert.equal(propertyLabel(indentless.properties[0].value), 'alpha · beta');
});
