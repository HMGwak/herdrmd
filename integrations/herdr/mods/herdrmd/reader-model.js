// Presentation state only. The Rust CLI remains responsible for paths and bytes.
export const parentPath = (path) => path.split("/").slice(0, -1).join("/");
export const fileTitle = (path) => path.split("/").pop() || "문서";
export const documentStatus = (document) => `${document.bytes.toLocaleString()} bytes · ${document.encoding}${document.bom ? " BOM" : ""} · ${document.line_endings}`;

// Shared validation for a CLI read bundled with link resolution. Raw source is
// accepted unchanged, including unsupported text=null; a different path is not.
export function isReadDocument(document, path) {
  return document !== null && typeof document === "object" && !Array.isArray(document) &&
    document.path === path && typeof document.revision === "string" && /^[0-9a-f]{64}$/i.test(document.revision) &&
    Number.isSafeInteger(document.bytes) && document.bytes >= 0 &&
    typeof document.bom === "boolean" && typeof document.final_newline === "boolean" && typeof document.read_only === "boolean" &&
    ["none", "lf", "crlf", "cr", "mixed"].includes(document.line_endings) &&
    ((typeof document.text === "string" && document.encoding === "utf-8") ||
      (document.text === null && document.encoding === "unsupported"));
}

export const TREE_MAX_VISIBLE = 1500;
export const TREE_MAX_ENTRIES = 2000;
export const TREE_MAX_FOLDERS = 64;
export const TREE_MAX_DEPTH = 32;

export class ReaderModel {
  constructor(request) {
    this.request = request;
    this.folders = new Map();
    this.expanded = new Set();
    this.treeEpoch = 0;
    this.revealSequence = 0;
    this.cacheClock = 0;
    // Only one folder query runs at a time. Expanding a branch never crawls it.
    this.listQueue = Promise.resolve();
    this.treeNotice = "";
    this.refreshing = false;
    this.selected = "";
    this.tabs = [];
    this.documents = new Map();
    this.readLoading = false;
    this.readError = "";
    this.readSequence = 0;
    this.closed = false;
    this.folder("");
  }

  get document() { return this.documents.get(this.selected); }
  get entries() { return this.folders.get("")?.entries || []; }
  get cachedEntries() { return [...this.folders.values()].reduce((sum, folder) => sum + folder.entries.length, 0); }

  ancestorsExpanded(path) {
    let parent = parentPath(path);
    while (parent) {
      if (!this.expanded.has(parent)) return false;
      parent = parentPath(parent);
    }
    return true;
  }

  evictCollapsed(requiredEntries = 0, requiredFolders = 0, keep = "") {
    const candidates = [...this.folders.entries()]
      .filter(([path]) => path && path !== keep && !keep.startsWith(`${path}/`) &&
        (!this.expanded.has(path) || !this.ancestorsExpanded(path)))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [path, folder] of candidates) {
      if (this.cachedEntries + requiredEntries <= TREE_MAX_ENTRIES && this.folders.size + requiredFolders <= TREE_MAX_FOLDERS) break;
      folder.token += 1;
      this.folders.delete(path);
      this.expanded.delete(path);
    }
  }

  folder(path) {
    let folder = this.folders.get(path);
    if (!folder) {
      this.evictCollapsed(0, 1, path);
      if (this.folders.size >= TREE_MAX_FOLDERS) {
        this.treeNotice = "탐색기 폴더 한도에 도달했습니다. 다른 폴더를 접고 다시 펼쳐주세요.";
        return null;
      }
      folder = { entries: [], loaded: false, loading: false, error: "", truncated: false, limited: false, token: 0, promise: null, used: 0 };
      this.folders.set(path, folder);
    }
    folder.used = ++this.cacheClock;
    return folder;
  }

  list(path, force = false) {
    if (this.closed) return Promise.resolve();
    const folder = this.folder(path);
    if (!folder) return Promise.resolve();
    if (!force && folder.loading && folder.promise) return folder.promise;
    if (!force && folder.loaded && !folder.error) return Promise.resolve();
    const token = ++folder.token, epoch = this.treeEpoch;
    folder.loading = true;
    folder.error = "";
    const current = () => !this.closed && epoch === this.treeEpoch &&
      token === folder.token && this.folders.get(path) === folder;
    const work = this.listQueue.then(async () => {
      if (!current()) return;
      try {
        const result = await this.request("files", path);
        if (!current()) return;
        const growth = Math.max(0, result.entries.length - folder.entries.length);
        this.evictCollapsed(growth, 0, path);
        const available = Math.max(0, TREE_MAX_ENTRIES - this.cachedEntries + folder.entries.length);
        folder.entries = result.entries.slice(0, available);
        folder.loaded = true;
        folder.limited = result.entries.length > available;
        folder.truncated = result.truncated;
      } catch (error) {
        if (current()) folder.error = String(error);
      } finally {
        if (current()) { folder.loading = false; folder.promise = null; }
      }
    });
    folder.promise = work;
    this.listQueue = work;
    return work;
  }

  cancelBranch(path) {
    for (const [candidate, folder] of this.folders) {
      if (candidate === path || candidate.startsWith(`${path}/`)) {
        folder.token += 1;
        folder.loading = false;
        folder.promise = null;
      }
    }
  }

  collapseBranch(path) {
    for (const expanded of this.expanded) {
      if (expanded === path || expanded.startsWith(`${path}/`)) this.expanded.delete(expanded);
    }
    this.cancelBranch(path);
  }

  async toggleFolder(path) {
    if (this.closed) return;
    this.revealSequence += 1;
    this.treeNotice = "";
    if (this.expanded.has(path)) {
      this.collapseBranch(path);
      return;
    }
    if (path.split("/").length > TREE_MAX_DEPTH) {
      this.treeNotice = `탐색기는 최대 ${TREE_MAX_DEPTH}단계까지 펼칠 수 있습니다.`;
      return;
    }
    if (!this.folder(path)) return;
    this.expanded.add(path);
    await this.list(path);
  }

  collapseAll() {
    if (this.closed) return;
    this.revealSequence += 1;
    this.expanded.clear();
    this.treeNotice = "";
    for (const path of this.folders.keys()) if (path) this.cancelBranch(path);
  }

  async reveal(path) {
    if (this.closed) return;
    const sequence = ++this.revealSequence;
    const ancestors = path.split("/").slice(0, -1);
    if (ancestors.length > TREE_MAX_DEPTH) return;
    await this.list("");
    let parent = "";
    for (const part of ancestors) {
      if (this.closed || sequence !== this.revealSequence || this.selected !== path) return;
      const child = parent ? `${parent}/${part}` : part;
      const entry = this.folders.get(parent)?.entries.find((entry) => entry.directory && entry.path === child);
      if (!entry || !this.folder(child)) return;
      this.expanded.add(child);
      await this.list(child);
      if (this.folders.get(child)?.error) return;
      parent = child;
    }
  }

  async refreshTree() {
    if (this.closed) return;
    const paths = [...this.expanded].filter((path) => this.ancestorsExpanded(path))
      .sort((a, b) => a.split("/").length - b.split("/").length);
    const epoch = ++this.treeEpoch;
    this.revealSequence += 1;
    this.refreshing = true;
    this.treeNotice = "";
    this.expanded = new Set(paths);
    for (const [path, folder] of this.folders) {
      folder.token += 1;
      folder.loading = false;
      folder.promise = null;
      if (path && !this.expanded.has(path)) this.folders.delete(path);
    }
    try {
      await this.list("", true);
      for (const path of paths) {
        if (this.closed || epoch !== this.treeEpoch) return;
        if (!this.expanded.has(path) || !this.ancestorsExpanded(path)) continue;
        const parent = this.folders.get(parentPath(path));
        if (!parent?.entries.some((entry) => entry.directory && entry.path === path)) {
          this.collapseBranch(path);
          for (const cached of this.folders.keys()) {
            if (cached === path || cached.startsWith(`${path}/`)) this.folders.delete(cached);
          }
          continue;
        }
        await this.list(path, true);
      }
    } finally {
      if (!this.closed && epoch === this.treeEpoch) this.refreshing = false;
    }
  }

  tree() {
    const rows = [];
    let limited = false;
    const append = (row) => {
      if (rows.length >= TREE_MAX_VISIBLE) { limited = true; return false; }
      rows.push(row);
      return true;
    };
    const visit = (path, depth) => {
      const folder = this.folders.get(path);
      if (!folder || depth > TREE_MAX_DEPTH || limited) return;
      if (folder.loading) append({ kind: "loading", path, depth });
      if (folder.error) append({ kind: "error", path, depth, message: folder.error });
      for (const entry of folder.entries) {
        if (!append({ kind: "entry", path: entry.path, depth, entry })) return;
        if (entry.directory && this.expanded.has(entry.path)) visit(entry.path, depth + 1);
        if (limited) return;
      }
      if (folder.limited || folder.truncated) append({ kind: "limit", path, depth, cache: folder.limited });
      if (folder.loaded && !folder.loading && !folder.error && !folder.entries.length && !folder.limited && !folder.truncated)
        append({ kind: "empty", path, depth });
    };
    visit("", 0);
    return { rows, limited };
  }

  get visibleEntries() { return this.tree().rows.filter((row) => row.kind === "entry").map((row) => row.entry); }

  async open(path, refresh = false, prefetchedDocument = null) {
    if (this.closed) return;
    const sequence = ++this.readSequence;
    this.selected = path;
    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.readError = "";
    this.readLoading = false;
    if (prefetchedDocument !== null && prefetchedDocument !== undefined) {
      if (!isReadDocument(prefetchedDocument, path)) { this.readError = "잘못된 문서 읽기 응답입니다."; return; }
      this.documents.set(path, prefetchedDocument);
      return;
    }
    if (!refresh && this.documents.has(path)) return;
    this.readLoading = true;
    try {
      const result = await this.request("read", path);
      if (this.closed || sequence !== this.readSequence) return;
      this.documents.set(path, result);
    } catch (error) {
      if (this.closed || sequence !== this.readSequence) return;
      this.readError = String(error);
    } finally {
      if (!this.closed && sequence === this.readSequence) this.readLoading = false;
    }
  }

  async closeTab(path) {
    if (this.closed) return;
    const index = this.tabs.indexOf(path);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    this.documents.delete(path);
    if (this.selected !== path) return;
    this.readSequence += 1;
    this.selected = "";
    this.readError = "";
    this.readLoading = false;
    const next = this.tabs[Math.min(index, this.tabs.length - 1)];
    if (next) await this.open(next);
  }

  close() {
    this.closed = true;
    this.treeEpoch += 1;
    this.revealSequence += 1;
    this.folders.clear();
    this.expanded.clear();
    this.readSequence += 1;
    this.documents.clear();
  }
}
