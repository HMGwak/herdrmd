import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme } from "herdr";

// Settings entry only. The selected folder is resolved by the same host/registry
// as the reader; this view never registers a Vault or writes launcher settings.
export class VaultSettings {
  constructor(options, cx) {
    this.options = options;
    this.closed = false;
    this.vault = options.vault || "personal";
    this.label = options.label || `Obsidian · ${this.vault}`;
    this.path = "";
    this.error = "";
    cx.spawn(async cx => {
      try {
        const result = await exec(options.binary, ["vault", "list"],
          options.machine ? { on: options.machine } : {});
        if (this.closed) return;
        if (result.code !== 0) throw new Error(result.stderr.trim() || "볼트 정보를 가져오지 못했습니다.");
        const selected = JSON.parse(result.stdout).vaults?.find(vault => vault.name === this.vault);
        if (!selected || typeof selected.path !== "string") throw new Error("등록된 볼트를 찾지 못했습니다.");
        this.path = selected.path;
      } catch (error) {
        if (this.closed) return;
        this.error = String(error);
      }
      if (!this.closed) cx.notify();
    });
  }

  close() { this.closed = true; }

  render(cx, onClose) {
    const t = theme();
    const field = (label, value) => v_flex().gap(6)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(div().p(10).rounded(5).bg(t.input).text_size(13).child(value));
    return v_flex().id("herdrmd-vault-settings").size_full().min_h(0)
      .bg(t.surface).text_color(t.foreground)
      .child(h_flex().h(46).px(16).gap(10).items_center().flex_none()
        .child(div().id("settings-back").px(8).py(5).rounded(4).text_size(12)
          .cursor_pointer().accessibility_label("문서로 돌아가기")
          .hover(el => el.bg(t.hover)).child("← 문서로 돌아가기").on_click((_event, cx) => onClose(cx)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.muted).child("설정")))
      .child(div().h(1).bg(t.border).flex_none())
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(24).gap(22)
        .child(h_flex().gap(10).items_center()
          .child(image("mods/herdrmd/obsidian.svg").size(25))
          .child(v_flex().gap(3)
            .child(div().text_size(20).font_semibold().child("볼트 연결"))
            .child(div().text_size(12).text_color(t.muted).child(this.label))))
        .child(v_flex().max_w(720).w_full().gap(16)
          .child(field("연결된 컴퓨터", this.options.machine || "이 컴퓨터"))
          .child(field("Markdown 폴더", this.path || ""))
          .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        ));
  }
}
