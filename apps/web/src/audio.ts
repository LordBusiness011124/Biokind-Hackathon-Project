/** Tiny WebAudio blips (no asset files). Presentation only. */
let ctx: AudioContext | null = null, last = 0;
export const audio = { muted: false };
function tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.04) {
  if (audio.muted) return;
  const now = performance.now(); if (now - last < 90) return; last = now;
  try {
    ctx ??= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  } catch { /* audio unavailable */ }
}
export const sfx = {
  paid: () => tone(880, 0.09, 'triangle'), leave: () => tone(150, 0.25, 'sawtooth', 0.05),
  ui: () => tone(520, 0.06, 'square', 0.03), year: () => { tone(523, 0.15, 'triangle', 0.05); setTimeout(() => tone(784, 0.25, 'triangle', 0.05), 160); },
};
