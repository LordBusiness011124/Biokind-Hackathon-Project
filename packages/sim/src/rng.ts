/** mulberry32 with serializable state. Never use Math.random() for gameplay. */
export interface RngState { s: number; }
export function makeRng(seed: number): RngState { return { s: (seed >>> 0) || 1 }; }
export function next(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function poisson(r: RngState, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda > 60) { // normal approx (not hit in default game)
    const u1 = Math.max(next(r), 1e-12), u2 = next(r);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)));
  }
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= next(r); } while (p > L);
  return k - 1;
}
export function pickCumulative(r: RngState, cum: number[]): number {
  const u = next(r) * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
  return lo;
}
