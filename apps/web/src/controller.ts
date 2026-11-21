import { Simulation, makeDemoAsset, validateAsset, deserialize, serialize, END_YEAR, type Action, type ActionResult, type AnnualSnapshot, type ModelAsset, type SimEvent, type Visit } from '@hospital/sim';

const SAVE_KEY = 'ht2044-save-v1';
const files = import.meta.glob('../../../packages/model-assets/derived/meps_baseline.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function loadAsset(): { asset: ModelAsset; error?: string } {
  const raw = Object.values(files)[0];
  if (!raw) return { asset: makeDemoAsset(), error: 'MEPS model asset not found (run `npm run data`). Running DEMO SYNTHETIC mode.' };
  try { validateAsset(raw); return { asset: raw }; }
  catch (e) { return { asset: makeDemoAsset(), error: `MEPS asset invalid: ${(e as Error).message}. Running DEMO SYNTHETIC mode.` }; }
}

/** Headless no-intervention branch with the same seed (decisions are the only difference). */
export function runControl(asset: ModelAsset, seed: number, years: number): AnnualSnapshot[] {
  const c = Simulation.create(asset, seed, undefined, 'control');
  while (!c.state.finished && !c.state.bankrupt && c.state.snapshots.length < years) c.runToYearEnd();
  return c.state.snapshots;
}

type Listener = () => void;
export const SPEEDS = [1, 3, 10] as const;
const TICKS_PER_SECOND_AT_1X = 2; // 1 tick = 1 simulated hour

export class Controller {
  sim: Simulation; asset: ModelAsset; assetError?: string;
  paused = true; speed: (typeof SPEEDS)[number] = 1;
  report: AnnualSnapshot | null = null;   // year-end overlay
  selected: Visit | null = null;
  messages: string[] = [];
  focusTab: string | null = null; tabNonce = 0;
  events: SimEvent[] = [];                // drained by the Phaser scene
  version = 0;
  private listeners = new Set<Listener>();
  private acc = 0; private raf = 0; private last = 0; private uiAcc = 0;

  constructor(seed = 2024) {
    const { asset, error } = loadAsset(); this.asset = asset; this.assetError = error;
    this.sim = Simulation.create(asset, seed);
    this.say(this.isDemo ? 'DEMO MODE: synthetic placeholder data.' : 'Welcome to 2024. Data: MEPS HC-256 + HC-254D/E/F.');
  }
  get isDemo() { return this.asset.provenanceKind === 'DEMO_SYNTHETIC'; }
  subscribe = (l: Listener) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((l) => l()); }
  say(m: string) { this.messages = [m, ...this.messages].slice(0, 30); }

  start() { cancelAnimationFrame(this.raf); this.last = performance.now(); const loop = (t: number) => { this.frame(t); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { cancelAnimationFrame(this.raf); }
  private frame(t: number) {
    const dt = Math.min(0.25, (t - this.last) / 1000); this.last = t;
    if (!this.paused && !this.report && !this.sim.state.finished && !this.sim.state.bankrupt) {
      this.acc += dt * TICKS_PER_SECOND_AT_1X * this.speed;
      const n = Math.floor(this.acc);
      if (n > 0) { this.acc -= n; this.run(n); }
    }
    this.uiAcc += dt; if (this.uiAcc > 0.1) { this.uiAcc = 0; this.emit(); }
  }
  private run(n: number) {
    const onEvent = (e: SimEvent) => { if (this.events.length < 400) this.events.push(e); this.log(e); };
    const r = this.sim.advance(n, { onEvent, stopAtYearEnd: true });
    if (r.yearClosed) this.onYearClosed();
    if (this.sim.state.bankrupt) { this.paused = true; this.say('The hospital has gone bankrupt (cash negative for over 60 days).'); this.report = this.sim.state.snapshots.at(-1) ?? null; }
  }
  private log(e: SimEvent) {
    if (e.type === 'leave') this.say(`${e.visit.service === 'emergency' ? 'ER over capacity: patient transferred/left unseen' : 'Clinic backlog: patient left unseen'} (${e.visit.patient.payer})`);
  }
  private onYearClosed() {
    this.paused = true; this.report = this.sim.state.snapshots.at(-1)!; this.save();
    this.say(`Year ${this.report.year} closed: net ${(this.report.netCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
  }

  // ---- player-facing API ----
  togglePause() { if (!this.report) this.paused = !this.paused; this.emit(); }
  setSpeed(s: (typeof SPEEDS)[number]) { this.speed = s; this.paused = false; this.emit(); }
  act(a: Action): ActionResult { const r = this.sim.applyAction(a); if (!r.ok) this.say(`Action failed: ${r.error}`); this.emit(); return r; }
  simToYearEnd() { const y = this.sim.state.year; this.paused = true; this.events = [];
    this.sim.runToYearEnd(); if (this.sim.state.snapshots.at(-1)?.year === y) this.onYearClosed(); else if (this.sim.state.bankrupt) this.run(0); this.emit(); }
  simTo2044() { this.paused = true; this.events = []; this.sim.runToEnd(); this.report = this.sim.state.snapshots.at(-1) ?? null; this.save(); this.emit(); }
  dismissReport() {
    if (this.sim.state.finished || this.sim.state.bankrupt) return; // end state stays
    this.report = null; this.emit();
  }
  get gameOver() { return this.sim.state.finished || this.sim.state.bankrupt; }
  select(v: Visit | null) { this.selected = v; this.emit(); }
  openTab(tab: string) { this.focusTab = tab; this.tabNonce++; this.emit(); }
  restart(seed?: number) { this.sim = Simulation.create(this.asset, seed ?? this.sim.state.config.seed); this.report = null; this.paused = true; this.events = []; this.messages = []; this.say('New game.'); this.emit(); }

  save() { try { localStorage.setItem(SAVE_KEY, serialize(this.sim.state)); } catch { /* storage unavailable */ } }
  hasSave(): boolean { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  load(json?: string): boolean {
    try {
      const raw = json ?? localStorage.getItem(SAVE_KEY); if (!raw) return false;
      const st = deserialize(raw); this.sim = new Simulation(this.asset, st); this.report = null; this.paused = true; this.events = [];
      this.say(`Loaded save (${st.year}).`); this.emit(); return true;
    } catch (e) { this.say(`Could not load save: ${(e as Error).message}`); this.emit(); return false; }
  }
  exportJson(): string { return serialize(this.sim.state); }
}
export { END_YEAR };
