// Render-only adaptation. Targets are opaque to this module: Rust resolves paths.
const escapedLabel = (label) => Array.from(label, (character) => {
  const code = character.charCodeAt(0);
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) || (code >= 123 && code <= 126) ? `\\${character}` : character;
}).join("");

const indentWidth = (text) => Array.from(text).reduce((width, character) => width + (character === "\t" ? 4 - width % 4 : 1), 0);
const fence = (line) => /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);

export function fencedSegments(text) {
  const lines = text.split(/(\r\n|\n|\r)/);
  const segments = [];
  let plain = "", code = "", marker = "", length = 0;
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
  const flush = () => { if (plain) segments.push({ text: plain, code: false }); plain = ""; };
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index], whole = line + (lines[index + 1] || ""), match = fence(line);
    if (marker) {
      code += whole;
      if (match && match[1][0] === marker && match[1].length >= length && !match[2].trim()) {
        segments.push({ text: code, code: true }); code = ""; marker = "";
      }
    } else if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
      flush(); marker = match[1][0]; length = match[1].length; code = whole;
    } else {
      const nestedItem = listItem(line);
      if (/^(?: {4}|\t)/.test(line) && !nestedItem) {
        // Keep indented code, while clear list children inherit their list context.
        flush(); segments.push({ text: whole, code: true });
      } else plain += whole;
    }
  }
  flush();
  if (code) segments.push({ text: code, code: true });
  return segments;
}

function inline(text, links, scope) {
  // Pair equal backtick runs in advance, avoiding repeated scans of long code.
  const runs = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "`") continue;
    let end = index + 1;
    while (text[end] === "`") end += 1;
    runs.push({ start: index, end, length: end - index }); index = end - 1;
  }
  const next = new Map(), latest = new Map();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (latest.has(run.length)) next.set(run.start, latest.get(run.length));
    latest.set(run.length, run);
  }
  let output = "", index = 0, lineEnd = 0;
  while (index < text.length) {
    if (index >= lineEnd) {
      lineEnd = index;
      while (lineEnd < text.length && text[lineEnd] !== "\r" && text[lineEnd] !== "\n") lineEnd += 1;
      if (lineEnd === index) { output += text[index++]; continue; }
    }
    if (text[index] === "\\") { output += text.slice(index, index + 2); index += 2; continue; }
    if (text[index] === "`" && next.has(index)) {
      const end = next.get(index).end;
      output += text.slice(index, end); index = end; continue;
    }
    if (text.startsWith("<!--", index)) {
      const closing = text.indexOf("-->", index + 4), end = closing < 0 ? text.length : closing + 3;
      output += text.slice(index, end); index = end; continue;
    }
    if (text[index] === "<") {
      const rawCode = /^<(code|pre)\b[^>]*>/i.exec(text.slice(index));
      if (rawCode) {
        const close = new RegExp(`</${rawCode[1]}\\s*>`, "ig");
        close.lastIndex = index + rawCode[0].length;
        const match = close.exec(text), end = match ? match.index + match[0].length : text.length;
        output += text.slice(index, end); index = end; continue;
      }
      const closing = text.indexOf(">", index + 1);
      if (closing >= 0 && closing < lineEnd) { output += text.slice(index, closing + 1); index = closing + 1; continue; }
    }
    const embedded = text.startsWith("![[", index);
    if (embedded || text.startsWith("[[", index)) {
      const opening = index + (embedded ? 1 : 0);
      let end = opening + 2;
      while (end < lineEnd - 1 && !(text[end] === "]" && text[end + 1] === "]")) end += 1;
      if (end >= lineEnd - 1) { output += text.slice(index, lineEnd); index = lineEnd; continue; }
      const raw = text.slice(opening + 2, end), separator = raw.indexOf("|");
      const target = (separator < 0 ? raw : raw.slice(0, separator)).trim();
      const label = separator < 0 ? target : raw.slice(separator + 1).trim() || target;
      if (embedded || !target || raw.includes("[[") || /[\u0000-\u001f\u007f]/.test(raw)) output += text.slice(index, end + 2);
      else {
        const url = `herdrmd-wiki://resolve/${encodeURIComponent(scope)}/${links.length + 1}`;
        links.push({ url, target, label });
        output += `[${escapedLabel(label)}](${url})`;
      }
      index = end + 2;
      continue;
    }
    output += text[index++];
  }
  return output;
}

export function renderWikilinks(text, scope = "preview") {
  const links = [];
  const markdown = fencedSegments(text).map((segment) => segment.code ? segment.text : inline(segment.text, links, scope)).join("");
  return { markdown, links, byUrl: new Map(links.map((link) => [link.url, link])) };
}
