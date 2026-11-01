// Render-only adaptation. Targets are opaque to this module: Rust resolves paths.
const escapedLabel = (label) => Array.from(label, (character) => {
  const code = character.charCodeAt(0);
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) || (code >= 123 && code <= 126) ? `\\${character}` : character;
}).join("");

const indentWidth = (text) => Array.from(text).reduce((width, character) => width + (character === "\t" ? 4 - width % 4 : 1), 0);
const fence = (line) => /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);

const finish = steps => { let result; do { result = steps.next(); } while (!result.done); return result.value; };
export const fencedSegments = text => finish(fencedSegmentsSteps(text));

export function* fencedSegmentsSteps(text) {
  // Cache both newline positions so CR-only/LF-only files never rescan the tail.
  function* lines() {
    let start = 0, cr = text.indexOf("\r"), lf = text.indexOf("\n");
    while (start < text.length) {
      const end = Math.min(cr < 0 ? text.length : cr, lf < 0 ? text.length : lf);
      const after = end === text.length ? end : end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1);
      yield [text.slice(start, end), text.slice(end, after)];
      start = after;
      if (cr >= 0 && cr < start) cr = text.indexOf("\r", start);
      if (lf >= 0 && lf < start) lf = text.indexOf("\n", start);
    }
  }
  const segments = [];
  let plain = [], code = [], marker = "", length = 0;
  const listLevels = [];
  const listItem = (line) => {
    const item = /^([ \t]*)([-+*]|\d+[.)])([ \t]+)(.*)$/.exec(line);
    if (!item) {
      if (line.trim() && listLevels.length && indentWidth(/^[ \t]*/.exec(line)[0]) < listLevels[0].content) listLevels.length = 0;
      return false;
    }
    const indent = indentWidth(item[1]);
    while (listLevels.length && listLevels[listLevels.length - 1].indent > indent) listLevels.pop();
    const parent = listLevels[listLevels.length - 1];
    const sibling = parent?.indent === indent;
    const nested = parent && indent >= parent.content && indent < parent.content + 4;
    if (!sibling && !nested && indent > 3) return false;
    if (sibling) listLevels.pop();
    listLevels.push({ indent, content: indentWidth(item[1] + item[2] + item[3]) });
    return true;
  };
  const flush = () => { if (plain.length) segments.push({ text: plain.join(""), code: false }); plain = []; };
  let processed = 0;
  for (const [line, ending] of lines()) {
    if (++processed % 128 === 0) yield;
    const whole = line + ending, match = fence(line);
    if (marker) {
      code.push(whole);
      if (match && match[1][0] === marker && match[1].length >= length && !match[2].trim()) {
        segments.push({ text: code.join(""), code: true }); code = []; marker = "";
      }
    } else if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
      flush(); marker = match[1][0]; length = match[1].length; code = [whole];
    } else {
      const nestedItem = listItem(line);
      if (/^(?: {4}|\t)/.test(line) && !nestedItem) {
        // Keep indented code, while clear list children inherit their list context.
        flush(); segments.push({ text: whole, code: true });
      } else plain.push(whole);
    }
  }
  flush();
  if (code.length) segments.push({ text: code.join(""), code: true });
  return segments;
}

function* inline(text, links, scope) {
  // Pair equal backtick runs in advance, avoiding repeated scans of long code.
  const runs = Array.from(text.matchAll(/`+/g), match => ({
    start: match.index, end: match.index + match[0].length, length: match[0].length,
  }));
  yield;
  const next = new Map(), latest = new Map();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (index % 128 === 0) yield;
    const run = runs[index];
    if (latest.has(run.length)) next.set(run.start, latest.get(run.length));
    latest.set(run.length, run);
  }
  const output = [], special = /[\\`<!\[]/g, newline = /[\r\n]/g;
  let index = 0, lineEnd = 0;
  let processed = 0;
  while (index < text.length) {
    if (++processed % 128 === 0) yield;
    if (index >= lineEnd) {
      newline.lastIndex = index;
      lineEnd = newline.exec(text)?.index ?? text.length;
      if (lineEnd === index) { output.push(text[index++]); continue; }
    }
    if (text[index] === "\\") { output.push(text.slice(index, index + 2)); index += 2; continue; }
    if (text[index] === "`" && next.has(index)) {
      const end = next.get(index).end;
      output.push(text.slice(index, end)); index = end; continue;
    }
    if (text.startsWith("<!--", index)) {
      const closing = text.indexOf("-->", index + 4), end = closing < 0 ? text.length : closing + 3;
      output.push(text.slice(index, end)); index = end; continue;
    }
    if (text[index] === "<") {
      const rawCode = /^<(code|pre)\b[^>]*>/i.exec(text.slice(index));
      if (rawCode) {
        const close = new RegExp(`</${rawCode[1]}\\s*>`, "ig");
        close.lastIndex = index + rawCode[0].length;
        const match = close.exec(text), end = match ? match.index + match[0].length : text.length;
        output.push(text.slice(index, end)); index = end; continue;
      }
      const closing = text.indexOf(">", index + 1);
      if (closing >= 0 && closing < lineEnd) { output.push(text.slice(index, closing + 1)); index = closing + 1; continue; }
    }
    const embedded = text.startsWith("![[", index);
    if (embedded || text.startsWith("[[", index)) {
      const opening = index + (embedded ? 1 : 0);
      const end = text.indexOf("]]", opening + 2);
      if (end < 0 || end >= lineEnd - 1) { output.push(text.slice(index, lineEnd)); index = lineEnd; continue; }
      const raw = text.slice(opening + 2, end), separator = raw.indexOf("|");
      const target = (separator < 0 ? raw : raw.slice(0, separator)).trim();
      const label = separator < 0 ? target : raw.slice(separator + 1).trim() || target;
      if (embedded || !target || raw.includes("[[") || /[\u0000-\u001f\u007f]/.test(raw)) output.push(text.slice(index, end + 2));
      else {
        const url = `herdrmd-wiki://resolve/${encodeURIComponent(scope)}/${links.length + 1}`;
        links.push({ url, target, label });
        output.push(`[${escapedLabel(label)}](${url})`);
      }
      index = end + 2;
      continue;
    }
    // Copy ordinary prose in a single slice instead of appending every character.
    special.lastIndex = index + 1;
    const end = special.exec(text)?.index ?? text.length;
    output.push(text.slice(index, end));
    index = end;
  }
  return output.join("");
}

export const renderWikilinks = (text, scope = "preview") => finish(renderWikilinksSteps(text, scope));

export function* renderWikilinksSteps(text, scope = "preview") {
  const links = [], output = [];
  const segments = yield* fencedSegmentsSteps(text);
  for (const segment of segments) {
    yield;
    output.push(segment.code ? segment.text : yield* inline(segment.text, links, scope));
  }
  return { markdown: output.join(""), links, byUrl: new Map(links.map(link => [link.url, link])) };
}
