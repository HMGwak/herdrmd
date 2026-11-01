import { div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { exec, nextCommand, theme } from "herdr";
import { ReaderModel, parentPath, fileTitle, documentStatus } from "./reader-model.js";
import { VaultSettings } from "./vault-settings.js";

// The same read contract runs locally or on an explicitly selected core.
export class VaultReader {
  constructor(options, cx) {
    this.options = options;
    this.vault = options.vault || "personal";
    this.label = options.label || `Obsidian · ${this.vault}`;
    this.model = new ReaderModel((operation, path) => this.request(operation, path));
    this.settings = new VaultSettings(options, cx);
    this.settingsOpen = Boolean(options.settings);
    this.mode = "preview";
    this.compact = true;
    this.explorerOpen = true;
    this.notice = "";
    this.closed = false;
    this.editor = EditorState.new({ language: "markdown", value: "", readonly: true, soft_wrap: true });
    this.action(cx, () => this.model.list(""));
    if (options.file) this.open(options.file, cx);
    cx.spawn(async (cx) => {
      while (!this.closed) {
        const command = await nextCommand();
        if (this.closed) return;
        if (command === "refresh") this.refresh(cx);
        else if (command === "settings") { this.settingsOpen = true; cx.notify(); }
        else if (command === "settings-close") { this.settingsOpen = false; cx.notify(); }
        else if (command === "browse") { this.explorerOpen = true; cx.notify(); }
        else if (command === "source" || command === "preview") { this.mode = command; this.explorerOpen = false; cx.notify(); }
        else if (command === "read-first-note") {
          const entry = this.model.entries.find((entry) => !entry.directory);
          if (entry) this.open(entry.path, cx);
        } else if (/^open-entry-\d+$/.test(command)) {
          const entry = this.model.entries[Number(command.slice(11)) - 1];
          if (entry) this.selectEntry(entry, cx);
        }
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

  syncEditor() {
    if (this.closed) return;
    const document = this.model.document;
    if (document !== this.editorDocument) {
      this.editor.set_value(document?.text ?? "");
      this.editorDocument = document;
    }
  }

  action(cx, operation) {
    if (this.closed) return;
    cx.spawn(async (cx) => {
      const pending = operation();
      this.syncEditor();
      if (!this.closed) cx.notify();
      await pending;
      if (this.closed) return;
      this.syncEditor();
      cx.notify();
    });
  }

  open(path, cx) {
    this.explorerOpen = false;
    this.notice = "";
    this.action(cx, () => this.model.open(path));
  }

  selectEntry(entry, cx) {
    if (entry.directory) this.action(cx, () => this.model.list(entry.path));
    else this.open(entry.path, cx);
  }

  refresh(cx) {
    this.notice = "";
    this.action(cx, () => Promise.all([
      this.model.list(this.model.directory),
      this.model.selected ? this.model.open(this.model.selected, true) : Promise.resolve(),
    ]));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.model.close();
    this.settings.close();
    this.editor.release();
  }

  button(id, label, action, t, active = false) {
    return div().id(id).px(9).py(5).rounded(5).flex_none().cursor_pointer()
      .text_size(12).text_color(active ? t.foreground : t.muted)
      .bg(active ? t.raised : t.surface).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .accessibility_label(label).child(label).on_click((_event, cx) => action(cx));
  }

  explorer(t) {
    const m = this.model;
    return v_flex().id("vault-explorer").min_h(0).min_w(0).bg(t.chrome)
      .when(!this.compact, (el) => el.w(238).flex_none().border_r(1).border_color(t.border))
      .when(this.compact, (el) => el.flex_1())
      .child(h_flex().h(42).flex_none().items_center().px(9).gap(4).border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.muted).child("파일 탐색기"))
        .child(this.button("vault-root", "루트", (cx) => this.action(cx, () => m.list("")), t))
        .when(Boolean(m.directory), (el) => el.child(this.button("vault-parent", "↑ 상위", (cx) => this.action(cx, () => m.list(parentPath(m.directory))), t))))
      .child(div().px(12).py(9).flex_none().text_size(11).text_color(t.dim).truncate().tooltip(m.directory || "/").child(m.directory || "/"))
      .child(v_flex().id("vault-entries").flex_1().min_h(0).overflow_y_scrollbar().px(6).gap(2)
        .when(m.listLoading, (el) => el.child(div().px(6).py(10).text_size(12).text_color(t.muted).child("폴더를 불러오는 중…")))
        .when(Boolean(m.listError), (el) => el.child(v_flex().p(6).gap(6).child(div().text_size(12).child(m.listError))
          .child(this.button("retry-folder", "다시 불러오기", (cx) => this.action(cx, () => m.list(m.directory)), t))))
        .children(m.entries.map((entry, index) => h_flex().id(`vault-entry-${index}`).h(30).flex_none().px(7).gap(7).items_center().rounded(5).cursor_pointer()
          .bg(m.selected === entry.path ? t.raised : t.chrome)
          .hover((s) => s.bg(t.hover)).tooltip(entry.name)
          .on_click((_event, cx) => this.selectEntry(entry, cx))
          .child(div().w(14).flex_none().text_size(12).text_color(entry.directory ? t.muted : t.dim).child(entry.directory ? "▸" : "·"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(m.selected === entry.path ? t.foreground : t.muted).child(entry.name))))
        .when(!m.listLoading && !m.listError && !m.entries.length, (el) => el.child(div().p(8).text_size(12).text_color(t.muted).child("이 폴더에는 Markdown 문서가 없습니다."))))
      .child(div().px(12).py(8).flex_none().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(`${m.entries.length}개 항목${m.truncated ? " · 최대 1,000개 표시" : ""}`));
  }

  documentPane(t) {
    const m = this.model, document = m.document;
    let body;
    if (m.readLoading) body = div().p(28).text_size(13).text_color(t.muted).child("문서를 불러오는 중…");
    else if (m.readError) body = v_flex().p(24).gap(12).child(div().text_size(13).child(m.readError))
      .child(this.button("retry-document", "다시 읽기", (cx) => this.action(cx, () => m.open(m.selected, true)), t));
    else if (!document) body = v_flex().flex_1().items_center().justify_center().gap(12).p(24)
      .child(image("mods/herdrmd/obsidian.svg").size(36))
      .child(div().text_size(19).font_semibold().child("문서를 열어보세요"))
      .child(div().text_size(12).text_color(t.muted).child("파일 탐색기에서 Markdown 문서를 선택하세요."))
      .when(this.compact, (el) => el.child(this.button("empty-browse", "파일 탐색기 열기", (cx) => { this.explorerOpen = true; cx.notify(); }, t)));
    else if (document.text === null) body = div().p(24).text_size(13).text_color(t.muted).child("지원하지 않는 인코딩입니다. 원본은 변경하지 않았습니다.");
    else if (this.mode === "source") body = Editor.new(this.editor).flex_1().min_h(0);
    else body = v_flex().flex_1().min_h(0).px(this.compact ? 18 : 32).py(22)
      .child(TextView.markdown(`vault-preview-${m.selected}`, document.text).selectable(true).scrollable(true).flex_1().min_h(0)
        .on_link_click((url, cx) => {
          if (/^https?:\/\//i.test(url)) cx.open_url(url);
          else { this.notice = "문서 내부 링크 탐색은 준비 중입니다. 원문에서 링크를 확인하세요."; cx.notify(); }
        }));
    return v_flex().flex_1().min_w(0).min_h(0)
      .child(h_flex().id("vault-document-tabs").h(36).flex_none().min_w(0).overflow_x_scroll().bg(t.chrome).border_b(1).border_color(t.border)
        .when(!m.tabs.length, (el) => el.child(div().px(14).py(9).text_size(12).text_color(t.dim).child("열린 문서 없음")))
        .children(m.tabs.map((path, index) => h_flex().id(`document-tab-${index}`).h(36).max_w(230).min_w(90).flex_none().items_center().gap(8).pl(12).pr(5)
          .bg(m.selected === path ? t.surface : t.chrome).border_r(1).border_color(t.border).cursor_pointer().tooltip(path)
          .on_click((_event, cx) => this.open(path, cx))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(m.selected === path ? t.foreground : t.muted).child(fileTitle(path)))
          .child(div().id(`close-document-${index}`).size(22).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("문서 닫기").accessibility_label(`${fileTitle(path)} 닫기`).child("×").on_click((_event, cx) => {
              cx.stop_propagation(); this.action(cx, () => m.closeTab(path));
            })))))
      .child(h_flex().h(42).flex_none().min_w(0).px(12).gap(5).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).tooltip(m.selected || this.label).child(m.selected || this.label))
        .child(this.button("preview-mode", "읽기", (cx) => { this.mode = "preview"; cx.notify(); }, t, this.mode === "preview"))
        .child(this.button("source-mode", "원문", (cx) => { this.mode = "source"; cx.notify(); }, t, this.mode === "source")))
      .child(body);
  }

  render(cx) {
    if (this.settingsOpen) return this.settings.render(cx, () => { this.settingsOpen = false; cx.notify(); });
    const t = theme(), m = this.model;
    const showExplorer = !this.compact || this.explorerOpen;
    const showDocument = !this.compact || !this.explorerOpen;
    return v_flex().id("herdrmd-vault").size_full().min_h(0).min_w(0).bg(t.surface).text_color(t.foreground)
      .on_size_change(({ width }, cx) => {
        const compact = width < 620;
        if (compact !== this.compact) { this.compact = compact; cx.notify(); }
      })
      .child(h_flex().h(48).flex_none().min_w(0).px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(image("mods/herdrmd/obsidian.svg").size(21).flex_none())
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).tooltip(this.label).child(this.label))
        .when(this.compact, (el) => el.child(this.button("toggle-explorer", this.explorerOpen ? "문서" : "탐색기", (cx) => { this.explorerOpen = !this.explorerOpen; cx.notify(); }, t)))
        .child(this.button("refresh-vault", "새로고침", (cx) => this.refresh(cx), t))
        .child(this.button("vault-settings", "설정", (cx) => { this.settingsOpen = true; cx.notify(); }, t)))
      // h_flex centers children by default. Stretch the two full-height panes so
      // their inner flex scroll regions receive the actual available height.
      .child(h_flex().flex_1().min_h(0).min_w(0).items_stretch()
        .when(showExplorer, (el) => el.child(this.explorer(t)))
        .when(showDocument, (el) => el.child(this.documentPane(t))))
      .child(h_flex().h(28).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(10).text_color(t.dim)
        .child(div().flex_none().child("읽기 전용"))
        .child(div().flex_1().min_w(0).truncate().tooltip(this.notice || (m.document ? documentStatus(m.document) : "표준 Markdown 미리보기 · 원문 보기 지원"))
          .child(this.notice || (m.document ? documentStatus(m.document) : "표준 Markdown 미리보기 · 원문 보기 지원"))));
  }
}
