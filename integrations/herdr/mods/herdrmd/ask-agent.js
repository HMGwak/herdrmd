// No shell, document body, remote configuration, or conversation history is sent.
export function initialMessage(vault, file, skill) {
  return `Read the existing Vault instructions and the official Obsidian Markdown skill below. Then wait for the user's question; do not edit files or start other work yet.\n${JSON.stringify({ vault, file, skill }, null, 2)}`;
}

export function localSource(options, paneId, panes, spaces) {
  if (options.machine) throw new Error("ASK AGENT는 이 컴퓨터의 로컬 볼트에서만 사용할 수 있습니다.");
  const pane = panes.find(p => p.pane === paneId && p.mod === "herdrmd");
  const space = pane && spaces.find(s => s.tabs.some(t => t.id === pane.tab));
  if (!pane || !space) throw new Error("문서 pane을 확인할 수 없습니다.");
  if (space.machine) throw new Error("ASK AGENT는 로컬 Space에서만 사용할 수 있습니다.");
  return { pane: pane.pane, tab: pane.tab, space: space.id };
}

export function readyToAsk(model, edits, path, saved = false) {
  const state = edits.states.get(path);
  if (model.readError) throw new Error(model.readError);
  if (model.readLoading || model.selected !== path || !model.document || model.document.text === null)
    throw new Error("문서를 읽은 뒤 다시 시도하세요.");
  if (state?.error) throw new Error(state.error);
  if (!state || state.loading || state.reloading || state.blocked || (saved && (state.dirty || state.saving)))
    throw new Error("문서 저장 상태를 확인한 뒤 다시 시도하세요.");
}

export class AskAgent {
  constructor(host) { this.host = host; this.pending = false; this.linked = null; }
  async start(source, path) {
    if (this.pending) return;
    this.pending = true;
    const h = this.host;
    const valid = () => {
      if (h.closed()) throw new Error("문서 pane이 닫혔습니다.");
      const current = h.source(source.pane);
      if (current.tab !== source.tab || current.space !== source.space) throw new Error("문서 pane 위치가 바뀌었습니다.");
    };
    try {
      valid();
      if (this.linked && h.panes().some(p => p.pane === this.linked)) {
        await h.command("pane.focus", { pane: this.linked }); return;
      }
      this.linked = null;
      h.ready(path);
      const vault = await h.vault();
      if (typeof vault !== "string" || !/^(?:\/|[a-z]:[\\/])/i.test(vault)) throw new Error("등록된 로컬 볼트 경로가 필요합니다.");
      const skill = h.skill();
      if (!await h.readSkill(skill)) throw new Error("공식 obsidian-markdown skill을 먼저 설치하세요.");
      await h.checkCodex(vault);
      valid(); h.ready(path);
      await h.save(path);
      valid(); h.ready(path, true);
      const result = await h.command("pane.split", {
        pane: source.pane, direction: "right",
        argv: ["codex", "--no-daemon", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="max"', "-C", vault, initialMessage(vault, path, skill)],
      });
      // Keep the returned identity even if the source closes during launch.
      // The new terminal has its own lifetime; close() never terminates it.
      if (!result?.pane) throw new Error("에이전트 pane 응답을 확인할 수 없습니다.");
      this.linked = result.pane;
    } finally { this.pending = false; }
  }
}
