'use strict';
(function () {
  class PushToTalk {
    constructor({recorder, transcribe, submit, onState = () => {}, onError = () => {}, onLevel = () => {}, maxMs = 30000}) {
      Object.assign(this, {recorder, transcribe, submit, onState, onError, onLevel, maxMs});
      this.phase = 'idle'; this.generation = 0; this.held = false; this.pendingRelease = false;
    }
    state(phase) { this.phase = phase; this.onState(phase); }
    async press() {
      if (this.held || this.phase !== 'idle') return;
      this.held = true; this.pendingRelease = false;
      const generation = ++this.generation;
      this.startingCapture = true;
      this.state('starting');
      try {
        await this.recorder.start(this.onLevel);
        this.startingCapture = false;
        if (generation !== this.generation) { await this.recorder.cancel(); this.state('idle'); return; }
        this.state('listening');
        this.timer = setTimeout(() => { void this.release(); }, this.maxMs);
        if (this.pendingRelease || !this.held) await this.release();
      } catch (error) {
        this.startingCapture = false;
        if (generation === this.generation) { this.held = false; this.state('idle'); this.onError(error); }
        else if (this.phase === 'cancelling') this.state('idle');
      }
    }
    async release() {
      this.held = false;
      if (this.phase === 'starting') { this.pendingRelease = true; return; }
      if (this.phase !== 'listening') return;
      clearTimeout(this.timer);
      const generation = this.generation;
      this.state('transcribing');
      try {
        const audio = await this.recorder.stop();
        if (generation !== this.generation || !audio) return;
        const result = await this.transcribe(audio);
        if (generation !== this.generation) return;
        if (!result?.recognised || !result.text?.trim()) throw Error('No clear speech recognised. Hold Ctrl+Alt and try again.');
        this.state('submitting');
        await this.submit(result);
      } catch (error) {
        if (generation === this.generation) this.onError(error);
      } finally { if (generation === this.generation) this.state('idle'); }
    }
    async cancel() {
      ++this.generation; this.held = false; this.pendingRelease = false; clearTimeout(this.timer);
      // Do not admit another capture until a pending microphone start settles.
      this.state(this.startingCapture ? 'cancelling' : 'idle');
      await this.recorder.cancel();
      if (!this.startingCapture) this.state('idle');
    }
  }
  if (typeof window !== 'undefined') window.CODYPushToTalk = PushToTalk;
  if (typeof module !== 'undefined') module.exports = {PushToTalk};
})();
