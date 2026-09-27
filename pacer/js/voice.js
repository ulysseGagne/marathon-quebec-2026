// The spoken gap ("3 seconds behind") every 250 m to 2 km, offline, through earbuds or
// the phone speaker. Like everything in a web app, it only speaks while the app is on
// screen: iOS freezes web pages when the phone is locked.
//
// Two ways to speak:
// - Recorded clips (voice/*.mp3, rendered by tools/build_voice.py) played through Web Audio
//   in a "transient" audio session. On iOS that mixes with Apple Music: the music keeps
//   playing under the voice. Like any sound that mixes, it follows the side switch: on
//   silent, it is muted.
// - The iPhone's own voice (speechSynthesis): speaks any text, but takes the audio for
//   itself, so Apple Music pauses. Used when "over music" is off, for text with no clips
//   (the finish time), and as a fallback if a clip cannot play.

export class Voice {
  constructor() {
    this.enabled = true;
    this.mix = true;          // recorded clips over other apps' audio
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voice = null;
    this.ctx = null;
    this.out = null;
    this.buffers = new Map(); // clip id -> Promise<AudioBuffer>
    this.sources = [];
    this.log = null;          // test hook: (text, how) => void
    if (this.ok) {
      const pick = () => {
        const vs = window.speechSynthesis.getVoices();
        this.voice = vs.find((v) => /en[-_]CA/i.test(v.lang)) || vs.find((v) => /en[-_]US/i.test(v.lang)) ||
          vs.find((v) => /^en/i.test(v.lang)) || null;
      };
      pick();
      window.speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
    this.setMix(true);
  }

  setMix(on) {
    this.mix = on;
    // WebKit maps "transient" to a mixable session: other apps' music keeps playing.
    try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = on ? 'transient' : 'auto'; } catch { /* ignore */ }
  }

  // iOS only lets a page make sound after a user gesture: call this from one.
  unlock() {
    if (this.ok) {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch { /* ignore */ }
    }
    const ctx = this._context();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch { /* ignore */ }
  }

  _context() {
    if (this.ctx) return this.ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    } catch { this.ctx = null; }
    return this.ctx;
  }

  /**
   * text: what to say. clips: the same words as recorded clip ids (e.g. ['b3']), or null
   * when there are none (then the iPhone voice says the text).
   */
  say(text, { force = false, clips = null } = {}) {
    if (!force && !this.enabled) return;
    if (this.mix && clips && clips.length && this.ctx) this._play(clips, text);
    else this._speak(text);
  }

  async _play(ids, text) {
    const ctx = this.ctx;
    try {
      if (ctx.state !== 'running') {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
        if (ctx.state !== 'running') throw new Error('audio suspended');
      }
      const bufs = await Promise.all(ids.map((id) => this._buffer(id)));
      this._stop();
      let t = ctx.currentTime + 0.03;
      this.sources = bufs.map((b) => {
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.out);
        s.start(t);
        t += b.duration + 0.04;
        return s;
      });
      if (this.log) this.log(text, 'clips');
    } catch {
      this._speak(text);
    }
  }

  _buffer(id) {
    let p = this.buffers.get(id);
    if (!p) {
      p = fetch(`voice/${id}.mp3`)
        .then((r) => { if (!r.ok) throw new Error(`no clip ${id}`); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)));
      this.buffers.set(id, p);
      p.catch(() => this.buffers.delete(id));
      // keep a few dozen decoded clips (about 0.3 MB each once decoded)
      if (this.buffers.size > 48) this.buffers.delete(this.buffers.keys().next().value);
    }
    return p;
  }

  _stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* ignore */ } }
    this.sources = [];
    if (this.ok) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }

  _speak(text) {
    if (this.log) this.log(text, 'speech');
    if (!this.ok) return;
    try {
      this._stop();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = 1.05;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}
