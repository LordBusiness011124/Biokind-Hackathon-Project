import { audio, sfx } from './audio';
import { buildQuestions, replay, scorecard, summarize, Simulation, type Question, type Scorecard, makeDemoAsset, validateAsset, deserialize, type Action, type ActionResult, type AnnualSnapshot, type ModelAsset, type SimEvent, type Visit } from '@hospital/sim';

export interface Literacy { asked: number; correct: number; grantsCents: number }
const SAVE_KEY = 'ht2044-save-v1';
const files = import.meta.glob('../../../packages/model-assets/derived/meps_baseline.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function loadAsset(): { asset: ModelAsset; error?: string } {
  const raw = Object.values(files)[0];
  if (!raw) return { asset: makeDemoAsset(), error: 'MEPS model asset not found (run `npm run data`). Running DEMO SYNTHETIC mode.' };
  try { validateAsset(raw); return { asset: raw }; }
  catch (e) { return { asset: makeDemoAsset(), error: `MEPS asset invalid: ${(e as Error).message}. Running DEMO SYNTHETIC mode.` }; }
}

/** Headless no-intervention branch with the same seed (decisions are the only difference). */
export function runControl(asset: ModelAsset, seed: number, years: number, events = false): AnnualSnapshot[] {
  return replay(asset, seed, [], years, undefined, 'control', events).state.snapshots;
}
/** Re-run the player's decisions under other seeds, yielding to the UI between runs. */
export async function runBands(asset: ModelAsset, log: Controller['sim']['state']['actionLog'], years: number, n = 20, onProgress?: (i: number) => void, events = false) {
  const runs: Simulation[] = [];
  for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 0)); runs.push(replay(asset, 1000 + i, log, years, undefined, 'replay', events)); onProgress?.(i + 1); }
  return summarize(runs);
}

type Listener = () => void;
export const SPEEDS = [1, 3, 10] as const;
const TICKS_PER_SECOND_AT_1X = 2; // 1 tick = 1 simulated hour

export class Controller {
  sim: Simulation; asset: ModelAsset; assetError?: string;
  muted = false; showHelp = false; challenge = false;
  briefing: { year: number; questions: Question[]; picked: (number | null)[] } | null = null;
  literacy: Literacy = { asked: 0, correct: 0, grantsCents: 0 };
  /** What the player just decided (shown once, then cleared). */
  decisionResult: { title: string; optionLabel: string; text: string; failed: boolean; trustDelta: number; cashCents: number } | null = null;
  /** Set by the on-screen object buttons; the map scene consumes it and walks the administrator there. */
  walkRequest: string | null = null;
  private autoplayAfterBriefing = false;
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
    if (this.paused || this.report || this.briefing || this.sim.state.pendingCard || this.decisionResult || this.gameOver) return;   // nothing changes while idle: no clock, no re-render
    this.acc += dt * TICKS_PER_SECOND_AT_1X * this.speed;
    const n = Math.floor(this.acc);
    if (n > 0) { this.acc -= n; this.run(n); }
    this.uiAcc += dt; if (this.uiAcc > 0.2) { this.uiAcc = 0; this.emit(); }
  }
  private run(n: number) {
    const onEvent = (e: SimEvent) => { if (this.events.length < 400) this.events.push(e); this.log(e); };
    this.afterAdvance(this.sim.advance(n, { onEvent, stopAtYearEnd: true }).yearClosed);
  }
  /** Single place that turns "the simulation moved" into the year-end report or the game-over screen. */
  private afterAdvance(yearClosed: boolean) {
    const st = this.sim.state;
    if (st.bankrupt) {
      this.paused = true; this.report = st.snapshots.at(-1) ?? null; this.save(); sfx.leave();
      this.say('The hospital has gone bankrupt (cash negative for over 60 days).');
    } else if (yearClosed) {
      const snap = st.snapshots.at(-1)!; this.paused = true; this.report = snap; this.save(); sfx.year();
      this.say(`Year ${snap.year} closed: net ${(snap.netCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`);
    } else return;
    this.emit();
  }
  private log(e: SimEvent) {
    if (e.type !== 'leave') return;
    const v = e.visit, py = v.patient.payer;
    this.say(v.service === 'emergency' ? `ER over capacity: patient transferred/left unseen (${py})`
      : v.service === 'inpatient' ? `No ward capacity: admission transferred elsewhere (${py})` : `Clinic backlog: patient left unseen (${py})`);
  }
  // ---- player-facing API ----
  toggleMute() { audio.muted = this.muted = !this.muted; this.emit(); }
  /** Yearly MEPS briefing: predict a real statistic, see the answer with its CI and source, earn a small grant if right. */
  openBriefing(autoplay = false) {
    const st = this.sim.state; if (st.finished || st.bankrupt) return;
    const questions = buildQuestions(this.asset, st.year, 2, st.snapshots.at(-1));
    this.autoplayAfterBriefing = autoplay;
    if (!questions.length) { this.afterBriefing(); return; }
    this.paused = true; this.briefing = { year: st.year, questions, picked: questions.map(() => null) }; this.emit();
  }
  /** After the briefing comes the board meeting (if a decision is open); play starts only once it is settled. */
  private afterBriefing() { if (!this.sim.state.pendingCard && this.autoplayAfterBriefing) { this.autoplayAfterBriefing = false; this.setSpeed(1); } else this.emit(); }
  answer(qi: number, choice: number) {
    const b = this.briefing; if (!b || b.picked[qi] !== null) return; b.picked[qi] = choice;
    const q = b.questions[qi], ok = choice === q.answerIndex; this.literacy.asked++;
    if (ok) { this.literacy.correct++; if (this.act({ type: 'grant', cents: 2_500_000, reason: `${b.year}:${q.id}` }).ok) { this.literacy.grantsCents += 2_500_000; sfx.paid(); } } else sfx.leave();
    this.emit();
  }
  goTo(objectId: string) { this.walkRequest = objectId; this.emit(); }
  closeBriefing() { this.briefing = null; this.afterBriefing(); }
  /** Board meeting: choose an option for the open dilemma. Returns false (with a message) if it cannot be afforded. */
  decide(optionId: string): boolean {
    const pc = this.sim.state.pendingCard; if (!pc) return false;
    if (!this.act({ type: 'decide', cardId: pc.cardId, optionId }).ok) return false;
    const e = this.sim.state.decisionLog.at(-1)!;
    this.decisionResult = { title: e.title, optionLabel: e.optionLabel, text: e.text, failed: e.failed, trustDelta: e.trustDelta, cashCents: e.cashCents };
    this.say(`Board decision: ${e.optionLabel}${e.failed ? ' (setback)' : ''}`); e.failed ? sfx.leave() : sfx.paid(); this.emit(); return true;
  }
  closeDecisionResult() { this.decisionResult = null; if (this.autoplayAfterBriefing) { this.autoplayAfterBriefing = false; this.setSpeed(1); } this.emit(); }
  setHelp(on: boolean) { this.showHelp = on; this.emit(); }
  /** Only valid before the first year starts (intro screen). Challenge mode adds seeded yearly events. */
  setChallenge(on: boolean) { this.challenge = on; this.sim = Simulation.create(this.asset, this.sim.state.config.seed, undefined, 'baseline', on); this.emit(); }
  get card(): Scorecard { return scorecard(this.sim.state.snapshots, this.sim.a, { bankrupt: this.sim.state.bankrupt, finished: this.sim.state.finished, dataIq: this.literacy, reputation: this.sim.state.reputation }); }
  togglePause() { if (!this.report && !this.briefing) this.paused = !this.paused; this.emit(); }
  setSpeed(s: (typeof SPEEDS)[number]) { this.speed = s; this.paused = false; this.emit(); }
  act(a: Action): ActionResult { const r = this.sim.applyAction(a); if (!r.ok) this.say(`Action failed: ${r.error}`); this.emit(); return r; }
  simToYearEnd() {
    if (this.sim.state.pendingCard) { this.say('Make this year’s board decision first.'); this.emit(); return; }
    this.paused = true; this.events = []; const before = this.sim.state.snapshots.length;
    this.sim.runToYearEnd(); this.afterAdvance(this.sim.state.snapshots.length > before); this.emit();
  }
  /** Auto-play: every remaining decision is deferred to its default, with the consequences that brings. */
  simTo2044() { this.paused = true; this.events = []; this.sim.runToEnd(); this.afterAdvance(this.sim.state.finished); this.emit(); }
  dismissReport() {
    if (this.sim.state.finished || this.sim.state.bankrupt) return; // end state stays
    this.report = null; this.openBriefing(); this.emit();
  }
  get gameOver() { return this.sim.state.finished || this.sim.state.bankrupt; }
  select(v: Visit | null) { this.selected = v; this.emit(); }
  openTab(tab: string) { this.focusTab = tab; this.tabNonce++; this.emit(); }
  restart(seed?: number) { this.literacy = { asked: 0, correct: 0, grantsCents: 0 }; this.briefing = null; this.sim = Simulation.create(this.asset, seed ?? this.sim.state.config.seed, undefined, 'baseline', this.challenge); this.report = null; this.paused = true; this.events = []; this.messages = []; this.say('New game.'); this.emit(); }

  /** Saves and exports share one envelope: the simulation state plus the player's MEPS briefing score. */
  private envelope(): string { return JSON.stringify({ app: 'hospital-tycoon', v: 2, state: this.sim.state, literacy: this.literacy }); }
  save() { try { localStorage.setItem(SAVE_KEY, this.envelope()); } catch { /* storage unavailable */ } }
  hasSave(): boolean { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  load(json?: string): boolean {
    try {
      const raw = json ?? localStorage.getItem(SAVE_KEY); if (!raw) return false;
      const obj = JSON.parse(raw) as { state?: unknown; literacy?: Partial<Literacy> };   // v2 envelope, or a bare v1 state
      const st = deserialize(obj.state ? JSON.stringify(obj.state) : raw);
      const lit = obj.literacy; if (lit && [lit.asked, lit.correct, lit.grantsCents].every((n) => Number.isFinite(n))) this.literacy = { asked: lit.asked!, correct: lit.correct!, grantsCents: lit.grantsCents! };
      this.challenge = st.events; this.sim = new Simulation(this.asset, st); this.report = null; this.briefing = null; this.paused = true; this.events = [];
      this.say(`Loaded save (${st.year}).`); this.emit(); return true;
    } catch (e) { this.say(`Could not load save: ${(e as Error).message}`); this.emit(); return false; }
  }
  exportJson(): string { return this.envelope(); }
}
