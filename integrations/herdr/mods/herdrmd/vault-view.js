import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { exec, nextCommand, theme } from "herdr";

// The same Rust read contract runs locally or on an explicitly selected core.
// A remote Vault stays on its host; no local mirror or remote HTTP token is used.
export class VaultReader {
  constructor(options, cx) {
    this.options = options;
    this.vault = options.vault || "personal";
    this.directory = "";
    this.entries = [];
    this.browsing = true;
    this.sequence = 0;
    this.listSequence = 0;
    this.status = "개인 Obsidian에 연결 중…";
    this.file = "";
    this.editor = EditorState.new({ language: "markdown", value: "", readonly: true, soft_wrap: true });
    cx.spawn(async (cx) => {
      try {
        await this.list("");
        if (options.file) await this.read(options.file);
      } catch (error) { this.status = String(error); }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (command === "refresh") {
            await this.list(this.directory);
            if (this.file) await this.read(this.file);
          }
        } catch (error) { this.status = String(error); }
        cx.notify();
      }
    });
  }

  async request(operation, path) {
    const result = await exec(this.options.binary,
      [operation, "--vault", this.vault, "--path", path],
      this.options.machine ? { on: this.options.machine } : {});
    if (result.code !== 0) throw new Error(result.stderr.trim() || `읽기 실패 (${result.code})`);
    return JSON.parse(result.stdout);
  }

  async list(path) {
    const sequence = ++this.listSequence;
    const result = await this.request("files", path);
    if (sequence !== this.listSequence) return;
    this.directory = path;
    this.entries = result.entries;
    this.browsing = true;
    this.status = `${this.entries.length}개 항목${result.truncated ? " · 표시 한도 1,000개" : ""} · 읽기 전용`;
  }

  async read(path) {
    const sequence = ++this.sequence;
    const result = await this.request("read", path);
    if (sequence !== this.sequence) return;
    this.file = path;
    this.browsing = false;
    this.editor.set_value(result.text === null ? "지원하지 않는 인코딩입니다. 원본은 변경하지 않았습니다." : result.text);
    this.status = `${result.bytes.toLocaleString()} bytes · ${result.encoding}${result.bom ? " BOM" : ""} · ${result.line_endings} · 읽기 전용`;
  }

  action(cx, operation) {
    cx.spawn(async (cx) => {
      try { await operation(); } catch (error) { this.status = String(error); }
      cx.notify();
    });
  }

  close() { this.sequence += 1; this.editor.release(); }

  render(cx) {
    const t = theme();
    const row = (id, label, action) => div().id(id).p(8).rounded(4)
      .child(label).on_click((_event, cx) => this.action(cx, action));
    const parent = this.directory.split("/").slice(0, -1).join("/");
    const toggle = row("toggle-browser", this.browsing ? "문서 보기" : "폴더 보기", async () => {
      this.browsing = !this.browsing;
    });
    const refresh = row("refresh-vault", "새로고침", async () => {
      if (this.browsing || !this.file) await this.list(this.directory);
      else await this.read(this.file);
    });
    const content = this.browsing ? v_flex().id("vault-folders").flex_1().min_h(0).gap(4).overflow_y_scroll()
      .child(row("vault-root", "개인 볼트 /", () => this.list("")))
      .child(this.directory ? row("vault-parent", "↑ 상위 폴더", () => this.list(parent)) : div())
      .child(div().text_size(12).text_color(t.muted).child(this.directory || "/"))
      .children(this.entries.map((entry, index) => row(`vault-entry-${index}`,
        `${entry.directory ? "▸ " : ""}${entry.name}`,
        () => entry.directory ? this.list(entry.path) : this.read(entry.path)))) :
      v_flex().flex_1().min_h(0).gap(8)
        .child(div().text_size(12).child(this.file || "폴더 보기에서 Markdown 문서를 선택하세요."))
        .child(Editor.new(this.editor).flex_1());
    return v_flex().id("herdrmd-vault").size_full().p(16).gap(8)
      .bg(t.surface).text_color(t.foreground)
      .child(div().text_size(18).font_semibold().child("개인 Obsidian"))
      .child(div().text_size(12).text_color(t.muted).child("Mac 볼트 · 읽기 전용"))
      .child(h_flex().gap(8).child(toggle).child(refresh))
      .child(div().text_size(12).text_color(t.muted).child(this.status))
      .child(content);
  }
}
