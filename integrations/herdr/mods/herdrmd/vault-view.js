import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { exec, nextCommand, theme } from "herdr";
import { ReaderModel, parentPath, fileTitle, documentStatus } from "./reader-model.js";
import { VaultSettings } from "./vault-settings.js";
import { splitFrontmatter } from "./frontmatter.js";
import { frontmatterView } from "./frontmatter-view.js";
import { renderWikilinks } from "./wikilinks.js";
import { WikiNavigation } from "./wiki-navigation.js";

// The same read contract runs locally or on an explicitly selected core.
export class VaultReader {
  constructor(options, cx) {
    this.options = options;
    this.vault = options.vault || "personal";
    this.label = options.label || `Obsidian · ${this.vault}`;
    this.model = new ReaderModel((operation, path) => this.request(operation, path));
    this.settings = new VaultSettings(options, cx);
    this.settingsOpen = Boolean(options.settings);
    this.expandedProperties = new Set();
    this.previewMetadata = new WeakMap();
    this.previewLinks = new WeakMap();
    this.previewSequence = 0;
    this.wikiScope = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
        else if (command === "collapse-all") { this.model.collapseAll(); cx.notify(); }
        else if (command === "dismiss-link") { this.wikiNavigation?.cancel(); cx.notify(); }
        else if (command === "properties") this.toggleProperties(cx);
        else if (command === "browse") { this.explorerOpen = true; cx.notify(); }
        else if (command === "source" || command === "preview") { this.mode = command; this.explorerOpen = false; cx.notify(); }
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
    if (this.wikiNavigation?.state && !this.currentLinkSource(this.wikiNavigation.state.source)) this.wikiNavigation.cancel();
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

  open(path, cx, { notice = "", created = false, document = null } = {}) {
    this.wikiNavigation?.cancel();
    this.explorerOpen = false;
    // Set navigation feedback before spawn can publish the first loading frame.
    this.notice = notice;
    // A recreated path may still have an older open-tab snapshot in memory.
    this.action(cx, () => this.model.open(path, created, document));
    if (created) this.action(cx, async () => {
      await this.model.refreshTree();
      if (!this.closed && this.model.selected === path) await this.model.reveal(path);
    });
    else if (parentPath(path)) this.action(cx, () => this.model.reveal(path));
  }

  selectEntry(entry, cx) {
    if (entry.directory) this.action(cx, () => this.model.toggleFolder(entry.path));
    else this.open(entry.path, cx);
  }

  refresh(cx) {
    this.wikiNavigation?.cancel();
    this.notice = "";
    this.action(cx, () => Promise.all([
      this.model.refreshTree(),
      this.model.selected ? this.model.open(this.model.selected, true) : Promise.resolve(),
    ]));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.wikiNavigation?.close();
    this.model.close();
    this.expandedProperties.clear();
    this.settings.close();
    this.editor.release();
  }

  previewFor(document) {
    if (!this.previewMetadata.has(document)) this.previewMetadata.set(document, splitFrontmatter(document.text));
    if (!this.previewLinks.has(document)) {
      const metadata = this.previewMetadata.get(document);
      this.previewLinks.set(document, renderWikilinks(metadata ? metadata.body : document.text, `${this.wikiScope}-${++this.previewSequence}`));
    }
    return this.previewLinks.get(document);
  }

  currentLinkSource(source) {
    return !this.closed && source.path === this.model.selected && source.document === this.model.document && source.generation === this.model.readSequence;
  }

  async followTarget(from, target) {
    const result = await exec(this.options.binary,
      ["follow-read", "--vault", this.vault, "--from", from, "--target", target],
      this.options.machine ? { on: this.options.machine } : {});
    if (result.code !== 0) throw new Error(result.stderr.trim() || `링크 열기 실패 (${result.code})`);
    const payload = JSON.parse(result.stdout);
    if (!payload || !payload.resolution || typeof payload.resolution !== "object" || Array.isArray(payload.resolution))
      throw new Error("잘못된 링크 열기 응답입니다.");
    return { ...payload.resolution, document: payload.document };
  }

  followLink(index, cx) {
    const document = this.model.document;
    if (!document || document.text === null || this.model.readLoading || this.model.readError || this.closed) return;
    const link = this.previewFor(document).links[index];
    if (!link) return;
    if (!this.wikiNavigation) this.wikiNavigation = new WikiNavigation();
    const navigation = this.wikiNavigation;
    const source = { path: this.model.selected, document, generation: this.model.readSequence };
    this.notice = "";
    this.action(cx, async () => {
      const action = await navigation.follow(link.target, source, (from, target) => this.followTarget(from, target), (source) => this.currentLinkSource(source));
      if (action) this.openResolvedLink(action, cx);
    });
  }

  chooseLink(index, cx) {
    const action = this.wikiNavigation?.choose(index, (source) => this.currentLinkSource(source));
    if (action) this.openResolvedLink(action, cx);
  }

  openResolvedLink(action, cx) {
    if (!this.wikiNavigation?.current(action, (source) => this.currentLinkSource(source))) return;
    this.mode = "preview";
    const notice = [action.fragment ? "제목·블록 위치 이동은 준비 중입니다." : "",
      action.created ? "빈 문서를 만들었습니다." : action.fragment ? "문서만 열었습니다." : ""].filter(Boolean).join(" ");
    this.open(action.path, cx, { notice, created: action.created === true, document: action.document });
  }

  previewLink(url, document, path, cx) {
    if (this.closed || document !== this.model.document || path !== this.model.selected) return;
    const preview = this.previewFor(document), link = preview.byUrl.get(url);
    if (link) this.followLink(preview.links.indexOf(link), cx);
    else if (/^https?:\/\//i.test(url)) cx.open_url(url);
    else { this.notice = "이 링크 형식의 탐색은 아직 지원하지 않습니다. 원문에서 링크를 확인하세요."; cx.notify(); }
  }

  linkPanel(t) {
    const state = this.wikiNavigation?.state;
    if (!state || !this.currentLinkSource(state.source)) return null;
    return v_flex().id("wiki-link-status").flex_none().min_w(0).px(12).py(8).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().min_w(0).gap(8)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(state.message))
        .child(this.button("dismiss-wiki-link", "닫기", (cx) => { this.wikiNavigation.cancel(); cx.notify(); }, t)))
      .when(state.kind === "ambiguous", (el) => el
        .child(v_flex().id("wiki-link-choices").h(Math.min(5, state.matches.length) * 30).flex_none().min_h(0).overflow_y_scrollbar()
          .children(state.matches.map((path, index) => div().id(`wiki-link-choice-${index}`).h(30).flex_none().px(8).py(5).rounded(4)
            .text_size(12).text_color(t.foreground).truncate().tooltip(path).cursor_pointer().hover((s) => s.bg(t.hover))
            .accessibility_label(path).child(path).on_click((_event, cx) => this.chooseLink(index, cx)))))
        .when(state.limited, (el) => el.child(div().text_size(11).text_color(t.dim).child("처음 50개 경로까지 표시합니다. 볼트 안의 폴더 경로를 포함하면 대상을 좁힐 수 있습니다."))));
  }

  toggleProperties(cx) {
    const path = this.model.selected;
    if (!path) return;
    if (this.expandedProperties.has(path)) this.expandedProperties.delete(path);
    else this.expandedProperties.add(path);
    cx.notify();
  }

  button(id, label, action, t, active = false) {
    return div().id(id).px(9).py(5).rounded(5).flex_none().cursor_pointer()
      .text_size(12).text_color(active ? t.foreground : t.muted)
      .bg(active ? t.raised : t.surface).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .accessibility_label(label).child(label).on_click((_event, cx) => action(cx));
  }

  explorer(t) {
    const m = this.model, tree = m.tree();
    let entryIndex = 0;
    const rows = tree.rows.map((row) => {
      const indent = 8 + Math.min(row.depth, 11) * 14;
      if (row.kind === "entry") {
        const entry = row.entry, index = entryIndex++;
        const expanded = entry.directory && m.expanded.has(entry.path);
        return h_flex().id(`vault-entry-${index}`).h(30).flex_none().pl(indent).pr(7).gap(7).items_center().rounded(5).cursor_pointer()
          .bg(m.selected === entry.path ? t.raised : t.chrome).hover((s) => s.bg(t.hover)).tooltip(entry.path)
          .accessibility_label(`${entry.directory ? "폴더" : "Markdown 문서"}: ${entry.name}`)
          .on_click((_event, cx) => this.selectEntry(entry, cx))
          .child(div().w(10).flex_none().text_size(12).text_color(t.muted).child(entry.directory ? (expanded ? "▾" : "▸") : ""))
          .child(svg(`mods/herdrmd/${entry.directory ? (expanded ? "folder-open" : "folder") : "file-text"}.svg`)
            .size(16).flex_none().text_color(entry.directory ? t.muted : t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(m.selected === entry.path || expanded ? t.foreground : t.muted).child(entry.name));
      }
      const label = row.kind === "loading" ? "불러오는 중…" : row.kind === "empty" ? "Markdown 문서 없음" :
        row.kind === "error" ? row.message : row.cache ? "탐색기 항목 한도 · 다른 폴더를 접고 다시 불러오세요." : "이 폴더는 최대 1,000개 항목까지 표시합니다.";
      return v_flex().id(`vault-folder-${row.kind}-${row.path}`).flex_none().pl(indent + 21).pr(6).py(5).gap(5)
        .child(div().text_size(11).text_color(t.dim).child(label))
        .when(row.kind === "error" || (row.kind === "limit" && row.cache), (el) => el.child(this.button(`retry-folder-${row.path}`, "다시 불러오기",
          (cx) => this.action(cx, () => m.list(row.path, true)), t)));
    });
    const summary = m.treeNotice || (tree.limited ? "표시 한도 1,500행 · 다른 폴더를 접어주세요." : `${entryIndex}개 항목${m.refreshing ? " · 새로고침 중…" : ""}`);
    return v_flex().id("vault-explorer").min_h(0).min_w(0).bg(t.chrome)
      .when(!this.compact, (el) => el.w(238).flex_none().border_r(1).border_color(t.border))
      .when(this.compact, (el) => el.flex_1())
      .child(h_flex().h(42).flex_none().items_center().px(9).gap(4).border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.muted).child("파일 탐색기"))
        .child(this.button("collapse-folders", "모두 접기", (cx) => { m.collapseAll(); cx.notify(); }, t)))
      .child(div().px(12).py(9).flex_none().text_size(11).text_color(t.dim).truncate().tooltip(this.label).child(`${this.vault} /`))
      .child(v_flex().id("vault-entries").flex_1().min_h(0).overflow_y_scrollbar().px(6).gap(2).children(rows))
      .child(div().px(12).py(8).flex_none().border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(summary));
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
    else {
      const preview = this.previewFor(document), metadata = this.previewMetadata.get(document);
      const sourcePath = m.selected;
      body = v_flex().flex_1().min_h(0).min_w(0).px(this.compact ? 18 : 32).py(22)
      .when(Boolean(metadata), el => el.child(frontmatterView(metadata, this.expandedProperties.has(m.selected), t, cx => this.toggleProperties(cx))))
      .child(TextView.markdown(`vault-preview-${m.selected}`, preview.markdown).selectable(true).scrollable(true).flex_1().min_h(0)
        .on_link_click((url, cx) => this.previewLink(url, document, sourcePath, cx)));
    }
    const linkPanel = this.linkPanel(t);
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
      .when(Boolean(linkPanel), (el) => el.child(linkPanel))
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
        .child(div().flex_none().child("본문 읽기 전용"))
        .child(div().flex_1().min_w(0).truncate().tooltip(this.notice || (m.document ? documentStatus(m.document) : "표준 Markdown 미리보기 · 원문 보기 지원"))
          .child(this.notice || (m.document ? documentStatus(m.document) : "표준 Markdown 미리보기 · 원문 보기 지원"))));
  }
}
