import { isReadDocument } from "./reader-model.js";

// Resolver response state, independent of the native view and path rules.
export class WikiNavigation {
  constructor() { this.sequence = 0; this.closed = false; this.state = null; }

  cancel() { this.sequence += 1; this.state = null; }
  close() { this.closed = true; this.cancel(); }
  current(action, isCurrent) { return !this.closed && action.sequence === this.sequence && isCurrent(action.source); }

  async follow(target, source, request, isCurrent) {
    if (this.closed || !isCurrent(source)) return null;
    const sequence = ++this.sequence;
    const action = { sequence, source, fragment: null, created: false };
    this.state = { ...action, kind: "loading", target, message: `‘${target}’ 링크를 여는 중…` };
    try {
      const result = await request(source.path, target);
      if (!this.current(action, isCurrent)) {
        if (!this.closed && sequence === this.sequence) this.state = null;
        return null;
      }
      if (!Array.isArray(result.matches) || result.matches.some((path) => typeof path !== "string") ||
        ![null, undefined].includes(result.fragment) && typeof result.fragment !== "string") throw new Error("잘못된 링크 조회 응답입니다.");
      action.fragment = result.fragment || null;
      if (result.status === "found" && result.matches.length === 1 && !result.truncated) {
        const document = result.document ?? null;
        if (document !== null && !isReadDocument(document, result.matches[0])) throw new Error("잘못된 문서 읽기 응답입니다.");
        this.state = null;
        return { ...action, path: result.matches[0], created: result.created === true, document };
      }
      const incomplete = result.status === "incomplete" || Boolean(result.truncated);
      if ((result.status === "ambiguous" && result.matches.length > 1) || (incomplete && result.matches.length > 0)) {
        this.state = { ...action, kind: "ambiguous", target, matches: result.matches.slice(0, 50),
          limited: result.matches.length > 50,
          message: incomplete ? "볼트 전체를 조회하지 못했습니다. 찾은 경로를 확인해 선택하세요." :
            `‘${target}’에 해당하는 문서가 여러 개입니다. 경로를 선택하세요.` };
      } else {
        const missing = result.status === "not_found";
        this.state = { ...action, kind: "message", target,
          message: incomplete ? "볼트 전체를 조회하지 못해 대상을 확정할 수 없습니다. 링크 경로·폴더 권한 또는 조회 한도를 확인하세요." :
            missing ? `‘${target}’ 문서를 찾지 못했습니다. 링크 이름과 볼트 경로를 확인하세요.` : "링크 대상을 확정할 수 없는 응답입니다." };
      }
    } catch (error) {
      if (this.current(action, isCurrent)) this.state = { ...action, kind: "message", target, message: `링크 열기 실패 · ${String(error)}` };
      else if (!this.closed && sequence === this.sequence) this.state = null;
    }
    return null;
  }

  choose(index, isCurrent) {
    const state = this.state;
    if (state?.kind !== "ambiguous" || !this.current(state, isCurrent) || !Number.isInteger(index) || index < 0 || index >= state.matches.length) return null;
    return { sequence: state.sequence, source: state.source, fragment: state.fragment, path: state.matches[index], created: false };
  }
}
