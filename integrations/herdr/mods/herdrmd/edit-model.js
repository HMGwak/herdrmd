// Per-document queues survive navigation; acknowledgements never replace newer input.
export class EditModel {
  constructor({ load, persist, write, changed = () => {} }) {
    Object.assign(this, { load, persist, write, changed });
    this.states = new Map();
  }
  async attach(document) {
    if (this.states.has(document.path)) {
      const existing = this.states.get(document.path);
      if (!existing.dirty && !existing.saving && !existing.loading && !existing.reloading && document.revision !== existing.revision) {
        existing.document = document; existing.text = document.text; existing.revision = document.revision;
      }
      return existing;
    }
    const state = { document, text: document.text, revision: document.revision, dirty: false, status: '저장됨', error: '', version: 0, queue: Promise.resolve(), saving: null, loading: true };
    this.states.set(document.path, state);
    try {
      const draft = await this.load(document.path);
      if (draft?.dirty && typeof draft.text === 'string' && /^[a-f0-9]{64}$/i.test(draft.revision)) {
        state.text = draft.text; state.revision = draft.revision; state.dirty = true;
        if (draft.text === document.text) { state.revision = document.revision; state.dirty = false; }
        state.status = state.dirty ? '저장 실패' : '저장됨'; state.error = state.dirty ? '미저장 초안을 복구했습니다. 확인 후 재시도하세요.' : '';
      }
    } catch (error) { state.status = '저장 실패'; state.error = `초안 읽기 실패: ${error}`; state.blocked = true; }
    state.loading = false;
    return state;
  }
  snapshot(state) { return { text: state.text, revision: state.revision, dirty: state.dirty }; }
  checkpoint(state) {
    state.pendingSnapshot = this.snapshot(state);
    if (!state.checkpointing) {
      state.checkpointing = true;
      state.queue = state.queue.catch(() => {}).then(async () => {
        try {
          while (state.pendingSnapshot) {
            const snapshot = state.pendingSnapshot;
            state.pendingSnapshot = null;
            await this.persist(state.document.path, snapshot);
          }
        } finally { state.checkpointing = false; }
      });
    }
    return state.queue;
  }
  edit(path, text) {
    const state = this.states.get(path);
    if (!state || state.loading || state.reloading || state.blocked || state.document.read_only || typeof text !== 'string' || text === state.text) return false;
    state.text = text; state.version += 1; state.dirty = true; state.status = state.saving ? '저장 중' : '수정 중'; state.error = '';
    this.checkpoint(state).catch(error => { state.status = '저장 실패'; state.error = `초안 저장 실패: ${error}`; this.changed(path); });
    this.changed(path); return true;
  }
  async retry(path) {
    const state = this.states.get(path);
    if (!state?.blocked || state.reloading) return this.flush(path);
    // A failed draft read has no editable changes. Re-read it rather than
    // letting Retry silently return from flush's blocked-state guard.
    await state.queue.catch(() => {});
    if (this.states.get(path) !== state || state.reloading) return;
    this.states.delete(path);
    const recovered = await this.attach(state.document);
    this.changed(path);
    return recovered;
  }
  async flush(path) {
    const state = this.states.get(path);
    if (!state || state.loading || state.reloading || state.blocked || state.document.read_only || (!state.dirty && state.status !== '저장 실패')) return;
    if (state.saving) return state.saving;
    state.saving = (async () => {
      try {
        await this.checkpoint(state);
        while (state.dirty) {
          await state.queue;
          const text = state.text, version = state.version, revision = state.revision;
          state.status = '저장 중'; this.changed(path);
          const document = await this.write(path, revision, text);
          state.document = document; state.revision = document.revision;
          if (state.version === version) { state.text = document.text; state.dirty = false; }
          await this.checkpoint(state);
        }
        state.status = '저장됨'; state.error = '';
      } catch (error) { state.status = '저장 실패'; state.error = String(error); }
      finally { state.saving = null; this.changed(path); }
    })();
    return state.saving;
  }
  // Explicit reload keeps the old dirty snapshot as a recovery record first.
  async reload(path, read, archive) {
    const state = this.states.get(path);
    if (state?.reloading) throw new Error('원본을 다시 읽는 중입니다.');
    if (state) state.reloading = true;
    try {
      if (state?.saving) await state.saving;
      if (state?.dirty || state?.blocked) {
        // An earlier failed checkpoint must not block archiving the in-memory
        // draft. CAS still protects the live draft file at the next checkpoint.
        await state.queue.catch(() => {});
        await archive(path, this.snapshot(state));
      }
      const document = await read();
      if (state) {
        Object.assign(state, { document, text: document.text, revision: document.revision, dirty: false, error: '', status: '저장됨', blocked: false });
        try { await this.checkpoint(state); }
        catch (error) { state.blocked = true; state.status = '저장 실패'; state.error = `초안 저장 실패: ${error}`; }
      }
      this.changed(path);
      return document;
    } finally { if (state) state.reloading = false; this.changed(path); }
  }
}
