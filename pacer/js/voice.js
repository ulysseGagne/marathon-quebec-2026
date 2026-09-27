// Spoken gap at every kilometre ("3 behind"). Works offline with iOS's built-in voices,
// through earbuds or the phone speaker.

export class Voice {
  constructor() {
    this.enabled = true;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voice = null;
    if (this.ok) {
      const pick = () => {
        const vs = window.speechSynthesis.getVoices();
        this.voice = vs.find((v) => /en[-_]CA/i.test(v.lang)) || vs.find((v) => /en[-_]US/i.test(v.lang)) ||
          vs.find((v) => /^en/i.test(v.lang)) || null;
      };
      pick();
      window.speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  // iOS only lets a page speak after it has spoken once from a user gesture.
  unlock() {
    if (!this.ok) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  say(text, { force = false } = {}) {
    if (!this.ok || (!this.enabled && !force)) return;
    try {
      const s = window.speechSynthesis;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = 1.05;
      u.volume = 1;
      s.speak(u);
    } catch { /* ignore */ }
  }
}
