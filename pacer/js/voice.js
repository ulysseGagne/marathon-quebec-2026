// The spoken calls ("5 seconds behind", "Water in 200 meters"), offline, through earbuds or
// the phone speaker, in the iPhone's own voice (speechSynthesis). Apple Music gets quieter
// while it talks and comes back after, and it speaks with the side switch on silent too.
// Like everything in a web app, it only speaks while the app is on screen: iOS freezes web
// pages when the phone is locked.

export class Voice {
  constructor() {
    this.enabled = true;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voice = null;
    this.since = 0;           // when the phrase being said started (ms)
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
  }

  // iOS only lets a page speak after a user gesture: call this from one.
  unlock() {
    if (!this.ok) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  say(text, { force = false } = {}) {
    if (!force && !this.enabled) return;
    if (this.log) this.log(text, 'speech');
    if (!this.ok) return;
    try {
      const synth = window.speechSynthesis;
      // After what is still being said, so a gap a second later does not cut "Water in 200
      // meters" short; unless that has gone on for a while (iOS can leave it stuck).
      if (!(synth.speaking && Date.now() - this.since < 4000)) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = 1.05;
      u.volume = 1;
      u.onstart = () => { this.since = Date.now(); };
      if (!synth.speaking) this.since = Date.now();
      synth.speak(u);
    } catch { /* ignore */ }
  }
}
