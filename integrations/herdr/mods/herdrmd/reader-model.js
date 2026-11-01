// Presentation state only. The Rust CLI remains responsible for paths and bytes.
export const parentPath = (path) => path.split("/").slice(0, -1).join("/");
export const fileTitle = (path) => path.split("/").pop() || "문서";
export const documentStatus = (document) => `${document.bytes.toLocaleString()} bytes · ${document.encoding}${document.bom ? " BOM" : ""} · ${document.line_endings}`;

export class ReaderModel {
  constructor(request) {
    this.request = request;
    this.directory = "";
    this.entries = [];
    this.truncated = false;
    this.listLoading = false;
    this.listError = "";
    this.selected = "";
    this.tabs = [];
    this.documents = new Map();
    this.readLoading = false;
    this.readError = "";
    this.listSequence = 0;
    this.readSequence = 0;
    this.closed = false;
  }

  get document() { return this.documents.get(this.selected); }

  async list(path) {
    if (this.closed) return;
    const sequence = ++this.listSequence;
    this.listLoading = true;
    this.listError = "";
    try {
      const result = await this.request("files", path);
      if (this.closed || sequence !== this.listSequence) return;
      this.directory = path;
      this.entries = result.entries;
      this.truncated = result.truncated;
    } catch (error) {
      if (this.closed || sequence !== this.listSequence) return;
      this.listError = String(error);
    } finally {
      if (!this.closed && sequence === this.listSequence) this.listLoading = false;
    }
  }

  async open(path, refresh = false) {
    if (this.closed) return;
    const sequence = ++this.readSequence;
    this.selected = path;
    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.readError = "";
    this.readLoading = false;
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
    this.listSequence += 1;
    this.readSequence += 1;
    this.documents.clear();
  }
}
