// Game-show sounds synthesised with Web Audio — no audio files to ship or license.
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', gain = 0.15) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sounds = {
  buzz() {
    tone(880, 0, 0.35, 'square', 0.18);
    tone(1320, 0, 0.35, 'square', 0.08);
  },
  correct() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.22));
  },
  wrong() {
    tone(196, 0, 0.5, 'sawtooth', 0.15);
    tone(185, 0.05, 0.5, 'sawtooth', 0.12);
  },
  timeup() {
    [0, 0.25, 0.5].forEach((s) => tone(440, s, 0.18, 'square', 0.12));
  },
  reveal() {
    tone(659, 0, 0.2, 'triangle', 0.15);
    tone(988, 0.12, 0.35, 'triangle', 0.15);
  },
  open() {
    tone(1200, 0, 0.12, 'sine', 0.12);
  },
  test() {
    tone(660, 0, 0.12, 'sine', 0.12);
  },
};
