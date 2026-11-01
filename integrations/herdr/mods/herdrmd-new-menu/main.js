// Personal clone of Herdr new-menu 0.1.11; existing menu actions are preserved.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, appHome, readTextFile, nextCommand } from "herdr";

import { parseTargets, launchArguments } from "./launcher.js";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    this.agents = [];
    this.targets = [];
    this.choosing = false;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${appHome()}/mods/herdrmd/launcher.json`);
        this.targets = parseTargets(text);
      } catch { this.targetFailed = true; }
      cx.notify();
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "choose-vault") { this.choosing = true; cx.notify(); }
        else if (command === "open-vault") this.openVault(this.targets[0]);
        else if (/^open-vault-[1-9][0-9]*$/.test(command)) {
          this.openVault(this.targets[Number(command.slice(11)) - 1]);
        }
      }
    });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try { this.agents = await knownAgents({ on: spaces().find(s => s.active)?.machine }); }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  openVault(target) {
    if (!target) return;
    const args = launchArguments(target, spaces().find(s => s.active)?.id);
    closeOverlay(props().overlay);
    run("tab.new", args);
  }

  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    if (this.choosing) {
      return v_flex().id("obsidian-vault-picker").w_full().h(74 + this.targets.length * 42)
        .bg(t.popover).p(8).gap(4).text_size(12.8).track_focus(this.handle)
        .on_key_down(e => {
          if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
          if (/^[1-9]$/.test(e.key)) this.openVault(this.targets[Number(e.key) - 1]);
        })
        .child(div().id("vault-back").p(6).text_color(t.dim).child("← 새 탭 메뉴")
          .on_click((_event, cx) => { this.choosing = false; cx.notify(); }))
        .child(div().px(6).text_color(t.muted).child("Obsidian 볼트 선택"))
        .children(this.targets.map((target, index) => h_flex().id(`vault-choice-${index}`)
          .h(38).px(8).gap(10).items_center().rounded(7).hover(s => s.bg(t.selected))
          .child(image("mods/herdrmd/obsidian.svg").size(20))
          .child(div().flex_1().child(target.name))
          .child(div().text_size(11).text_color(t.dim).child(String(index + 1)))
          .on_click(() => this.openVault(target))));
    }
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(540, 218 + Math.max(1, choices.length) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(v_flex().id("open-obsidian").h(48).px(9).gap(3).rounded(7).justify_center().flex_none()
        .text_color(this.targets.length ? t.foreground : t.dim)
        .when(this.targets.length > 0, el => el.hover(s => s.bg(t.selected)))
        .on_click((_event, cx) => {
          if (this.targets.length > 1) { this.choosing = true; cx.notify(); }
          else this.openVault(this.targets[0]);
        })
        .child(h_flex().gap(10).items_center()
          .child(image("mods/herdrmd/obsidian.svg").size(16))
          .child("Obsidian 볼트 열기"))
        .child(div().pl(24).text_size(11).text_color(t.dim)
          .child(this.targets.length > 1 ? `${this.targets.length}개 볼트` : this.targets[0]?.name || (this.targetFailed ? "연결 준비 필요" : "연결 확인 중…"))))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
