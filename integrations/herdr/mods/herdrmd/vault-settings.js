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
          .hover(el => el.bg(t.hover)).child("← 문서로 돌아가기").on_click(onClose))
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
          .child(field("Markdown 폴더", this.path || (this.error ? "경로를 확인하지 못했습니다." : "폴더 경로를 확인하는 중…")))
          .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
          .child(h_flex().gap(10).items_center()
            .child(div().id("choose-vault-folder-pending").px(12).py(7).rounded(5)
              .bg(t.raised).text_color(t.dim).text_size(12).cursor_not_allowed().child("폴더 경로 선택 · 준비 중"))
            .child(div().text_size(11).text_color(t.muted).child("현재 연결 유지")))
          .child(div().text_size(12).text_color(t.muted)
            .child("개인·회사 볼트의 컴퓨터와 Markdown 폴더를 직접 선택할 설정 자리입니다. 경로 변경은 이후에 연결됩니다."))
          .child(div().h(1).bg(t.border))
          .child(v_flex().gap(5)
            .child(div().text_size(12).font_semibold().child("읽기 전용"))
            .child(div().text_size(12).text_color(t.muted).child("설정 화면을 열어도 연결과 문서 원본은 바뀌지 않습니다.")))));
  }
}
