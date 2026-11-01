import { fencedSegments } from './wikilinks.js';
import { splitFrontmatter } from './frontmatter.js';

// Links exist only in the rendered copy. Offsets always refer to original UTF-16 text.
export function renderCheckboxes(text, scope) {
  const metadata = splitFrontmatter(text), start = metadata ? text.length - metadata.body.length : 0;
  const excluded = [];
  const protectedRegions = /<!--[\s\S]*?(?:-->|$)|<(pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|%%[\s\S]*?(?:%%|$)/gi;
  for (const match of text.matchAll(protectedRegions)) excluded.push([match.index, match.index + match[0].length]);
  // Markdown code spans may cross a line boundary before a task-shaped line.
  const runs = [...text.matchAll(/`+/g)], next = new Map(), latest = new Map();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index][0].length;
    if (latest.has(length)) next.set(index, latest.get(length));
    latest.set(length, index);
  }
  for (let index = 0; index < runs.length; index++) {
    if (!next.has(index)) continue;
    const closingIndex = next.get(index), closing = runs[closingIndex];
    excluded.push([runs[index].index, closing.index + closing[0].length]);
    index = closingIndex;
  }
  excluded.sort((a, b) => a[0] - b[0]);
  const regions = [];
  for (const region of excluded) {
    const previous = regions[regions.length - 1];
    if (previous && region[0] <= previous[1]) previous[1] = Math.max(previous[1], region[1]);
    else regions.push(region);
  }
  let protectedIndex = 0;
  let offset = start, markdown = text.slice(0, start);
  const byUrl = new Map();
  for (const segment of fencedSegments(text.slice(start))) {
    if (segment.code) markdown += segment.text;
    else markdown += segment.text.replace(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/gm, (whole, prefix, status, index) => {
      const position = offset + index + prefix.length + 1;
      while (protectedIndex < regions.length && regions[protectedIndex][1] <= position) protectedIndex++;
      if (protectedIndex < regions.length && regions[protectedIndex][0] <= position) return whole;
      const url = `herdrmd-check://toggle/${encodeURIComponent(scope)}/${position}`;
      byUrl.set(url, { position, status });
      return `${prefix}[${status === ' ' ? '☐' : '☑'}](${url})`;
    });
    offset += segment.text.length;
  }
  return { markdown, byUrl };
}
export function toggleCheckbox(text, target) {
  if (!target || text[target.position] !== target.status || text[target.position - 1] !== '[' || text[target.position + 1] !== ']') return null;
  return text.slice(0, target.position) + (target.status === ' ' ? 'x' : ' ') + text.slice(target.position + 1);
}
