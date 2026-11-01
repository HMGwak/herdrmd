import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import process from "process";
import { appHome, exec, nextCommand, props, theme } from "herdr";
import { connect } from "./api.js";
import { VaultReader } from "./vault-view.js";

const SAMPLE = "한글 연결 검증 — 안녕하세요 🌿\n둘째 줄과 공백을 그대로 보존합니다.\n";
const PROGRAMMATIC = "자동 입력 검증 — Rust ↔ Herdr 🌿\r\n마지막 개행도 유지합니다.\r\n";

export default class BridgeProbe extends View {
  init(_props, cx) {
    const options = props() || {};
    if (options.mode === "vault") {
      this.reader = new VaultReader(options, cx);
      return;
    }
    this.instance = `bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.status = "Starting task 00 bridge probe…";
    this.changes = 0;
    this.links = 0;
    this.editor = EditorState.new({ language: "markdown", value: SAMPLE, soft_wrap: true });
    this.editor.on("change", (_event, cx) => {
      this.changes += 1;
      if (this.api) {
        cx.spawn(async (cx) => {
          try {
            await this.api.event("editor_change", this.instance);
            await this.echo();
          } catch (error) {
            this.status = String(error);
          }
          cx.notify();
        });
      }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        const windows = process.platform === "win32" || process.platform === "windows" ||
          /^(?:[a-z]:[\\/]|\\\\)/i.test(appHome());
        const localPath = (value) => typeof value === "string" &&
          (windows ? /^(?:[a-z]:[\\/]|\\\\)/i.test(value) : value.startsWith("/"));
        // Shared tabs may carry another client's paths. Use a locally installed
        // probe on that client instead of trying to execute a Mac path on Windows.
        const binary = localPath(options.binary) ? options.binary :
          `${appHome()}/mods/herdrmd/herdrmd${windows ? ".exe" : ""}`;
        let stateDir = localPath(options.state_dir) ? options.state_dir : null;
        if (!stateDir) {
          const location = await exec(binary, ["bridge", "location"]);
          if (location.code !== 0) throw new Error("local bridge binary is unavailable");
          stateDir = JSON.parse(location.stdout).state_dir;
        }
        this.api = await connect(binary, stateDir, windows);
        await this.api.event("initialized", this.instance);
        await this.api.event("auth_rejection_observed", this.instance);
        await this.echo();
      } catch (error) {
        this.status = String(error);
      }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (!this.api) throw new Error("service not connected yet");
          if (command === "probe") {
            // A native programmatic change probe; this is not evidence of human typing.
            this.editor.set_value(PROGRAMMATIC);
            await this.api.event("programmatic_set", this.instance);
            await this.echo();
          } else if (command === "report") {
            const report = await this.api.request("/v1/probe");
            this.status = `pid ${report.pid} · echoes ${report.probe.echoes} · events ${report.probe.events.length}`;
          }
        } catch (error) {
          this.status = String(error);
        }
        cx.notify();
      }
    });
  }

  async echo() {
    const text = this.editor.value();
    const response = await this.api.request("/v1/echo", { text });
    if (response.text !== text) throw new Error("round-trip text mismatch");
    this.status = `PASS · GET + POST + auth · pid ${this.api.pid} · ${response.utf8_bytes} UTF-8 bytes`;
    this.returned = response.text;
  }

  async close(_cx) {
    if (this.reader) { this.reader.close(); return; }
    // Start cleanup here. Herdr allows only a best-effort 250 ms close budget.
    try {
      if (this.api) await this.api.event("closed", this.instance);
    } finally {
      this.editor.release();
    }
  }

  render(_cx) {
    if (this.reader) return this.reader.render(_cx);
    const t = theme();
    return v_flex().id("herdrmd-bridge").size_full().p(16).gap(10)
      .bg(t.surface).text_color(t.foreground)
      .child(div().text_size(18).font_semibold().child("herdrmd · 00 연결 검증"))
      .child(div().text_size(12).text_color(t.muted).child("합성 문장만 입력하세요. Vault·문서 저장 기능은 아직 없습니다."))
      .child(div().text_size(13).child(this.status))
      .child(div().text_size(12).text_color(t.muted).child(`native changes ${this.changes} · link clicks ${this.links}`))
      .child(Editor.new(this.editor).flex_1())
      .child(TextView.markdown("bridge-link", "[연결 검증 링크](herdrmd://probe)")
        .on_link_click((_url, cx) => {
          this.links += 1;
          if (this.api) {
            cx.spawn(async (cx) => {
              try {
                await this.api.event("link_click", this.instance);
                this.status = "PASS · native Markdown link callback";
              } catch (error) {
                this.status = String(error);
              }
              cx.notify();
            });
          }
          cx.notify();
        }))
      .child(h_flex().gap(12).child(div().id("echo-now").p(8).rounded(4).bg(t.raised)
        .child("한글 왕복 확인").on_click((_event, cx) => {
          cx.spawn(async (cx) => {
            try {
              if (!this.api) throw new Error("service not connected yet");
              await this.echo();
            } catch (error) {
              this.status = String(error);
            }
            cx.notify();
          });
        })))
      .child(div().text_size(12).text_color(t.muted).child("탭을 바꿨다가 돌아와 입력이 유지되는지 확인하세요. 닫기는 best effort로 기록합니다."));
  }
}
