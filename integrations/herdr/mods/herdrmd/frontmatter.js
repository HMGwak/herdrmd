// Display-only frontmatter extraction. Never reserializes YAML or changes source.
// This is deliberately not a YAML evaluator: unfamiliar mapping syntax stays raw.
export function splitFrontmatter(text) {
  if (typeof text !== "string") return null;
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(text);
  if (!opening) return null;
  const contentStart = opening[0].length;
  const closing = /^(---)[ \t]*(?:\r\n|\n|\r|$)/gm;
  closing.lastIndex = contentStart;
  // JS multiline anchors recognize bare CR too, while the match consumes CRLF.
  const end = closing.exec(text);
  if (!end) return null;
  const raw = text.slice(contentStart, end.index);
  const body = text.slice(end.index + end[0].length);
  const properties = [];
  let current = null, fallback = false;
  for (const line of raw.split(/\r\n|\n|\r/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[ \t]/.test(line) || (/^-\s/.test(line) && current?.lines[0] === "")) {
      if (current) current.lines.push(line);
      else fallback = true;
      continue;
    }
    const entry = /^([^\s"'#{}\[\],&*!|>@`?:][^:]*):(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (!entry) { fallback = true; current = null; continue; }
    current = { key: entry[1].trim(), lines: [entry[2] || ""] };
    properties.push(current);
  }
  const values = properties.map(({ key, lines }) => ({ key, value: lines.join("\n").trim() }));
  // Quoted keys, scalar/sequence documents and unusual YAML remain readable in
  // a small raw metadata panel instead of being dropped or interpreted.
  return { raw, body, properties: values, fallback: fallback || (!values.length && Boolean(raw.trim())) };
}

const scalarLabel = (value) => {
  if (/^"[\s\S]*"$/.test(value)) {
    try { const decoded = JSON.parse(value); if (typeof decoded === "string") return decoded; } catch { /* keep YAML spelling */ }
  }
  if (/^'[^\n]*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

export function propertyLabel(value) {
  if (!value) return "—";
  const lines = value.split(/\r\n|\n|\r/);
  if (lines.every(line => /^\s*-\s+\S/.test(line))) {
    return lines.map(line => scalarLabel(line.replace(/^\s*-\s+/, ""))).join(" · ");
  }
  if (/^\[.*\]$/.test(value)) {
    try {
      const list = JSON.parse(value);
      if (Array.isArray(list) && list.every(item => item === null || ["string", "number", "boolean"].includes(typeof item))) {
        return list.map(item => item === null ? "null" : String(item)).join(" · ") || "—";
      }
    } catch { /* non-JSON YAML flow sequences stay literal */ }
  }
  return scalarLabel(value).replace(/\s*\n\s*/g, " ");
}

export function frontmatterSummary(frontmatter) {
  if (frontmatter.fallback) return "YAML";
  const preferred = frontmatter.properties.filter(({ key }) => /^(status|type|tags|date|created)$/i.test(key));
  const properties = preferred.length ? preferred : frontmatter.properties;
  return properties.slice(0, 3).map(({ key, value }) => `${key}: ${propertyLabel(value)}`).join("  ·  ");
}
