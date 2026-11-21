import { DEFAULT_ASSUMPTIONS, type Assumptions } from './assumptions';
import { assetProvenance, type EventDist, type ModelAsset, type PaymentDist } from './assets';
import { makeRng, next, pickCumulative, poisson, type RngState } from './rng';
import {
  LEDGER_CATEGORIES, PLAYABLE, type Action, type ActionResult, type ActiveVisit, type AnnualSnapshot, type Department,
  type GroupStats, type LedgerCategory, type LedgerEntry, type LedgerTotals, type PayerGroup, type PlayableService,
  type ServiceMap, type SimEvent, type SyntheticPatient, type Visit,
} from './types';

export const START_YEAR = 2024;
export const END_YEAR = 2044;
const RING = 100;

// diurnal arrival profiles (fractions per hour of day, normalised). Illustrative MODEL_ASSUMPTION.
const ER_PROFILE = norm([2, 1.6, 1.4, 1.2, 1.2, 1.4, 1.8, 2.6, 3.6, 4.4, 4.8, 5, 5, 4.8, 4.6, 4.6, 4.8, 5, 5, 4.8, 4.2, 3.6, 3, 2.4]);
function profileFor(service: PlayableService, a: Assumptions): number[] {
  if (service === 'emergency') return ER_PROFILE;
  const [o, c] = a.staffing.outpatient.openHours;
  return norm(Array.from({ length: 24 }, (_, h) => (h >= o && h < c ? 1 : 0)));
}
function norm(a: number[]) { const s = a.reduce((x, y) => x + y, 0); return a.map((v) => v / s); }

interface ServiceModel { cum: number[]; cellIdx: number[]; annualEvents: number; }
export interface Config { seed: number; scenarioId: string; assumptions: Assumptions; }

export interface SimState {
  version: 1;
  config: { seed: number; scenarioId: string };
  year: number; tick: number; yearStartTick: number; finished: boolean; bankrupt: boolean; insolventDays: number;
  cashCents: number; cashStartOfYearCents: number;
  rng: RngState; nextVisitId: number;
  departments: Record<PlayableService, Department>;
  processLevel: number; subsidyBudgetCents: number; subsidyRemainingCents: number;
  ledger: LedgerTotals; recent: LedgerEntry[];
  yearAcc: YearAcc;
  snapshots: AnnualSnapshot[];
  decisionsThisYear: string[];
}
interface YearAcc {
  arrivals: ServiceMap<number>; treated: ServiceMap<number>; unmet: ServiceMap<number>; waitSum: ServiceMap<number>;
  byPayer: Record<string, GroupStats>; byIncome: Record<string, GroupStats>; oop: number; subsidized: number;
}
const gs = (): GroupStats => ({ arrivals: 0, treated: 0, unmet: 0, waitTicksSum: 0, oopCents: 0, subsidizedOopCents: 0 });
const zeroLedger = (): LedgerTotals => Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, 0])) as LedgerTotals;
const sm = (): ServiceMap<number> => ({ emergency: 0, outpatient: 0 });
const freshAcc = (): YearAcc => ({ arrivals: sm(), treated: sm(), unmet: sm(), waitSum: sm(), byPayer: {}, byIncome: {}, oop: 0, subsidized: 0 });

export function createInitialState(cfg: Partial<Config> & { seed: number }): SimState {
  const a = cfg.assumptions ?? DEFAULT_ASSUMPTIONS;
  const dept = (service: PlayableService, rooms: number, phys: number, nurses: number): Department =>
    ({ id: service, service, roomSlots: rooms, physicians: phys, nurses, queue: [], inService: [], capacityCredit: 0 });
  return {
    version: 1, config: { seed: cfg.seed, scenarioId: cfg.scenarioId ?? 'baseline' },
    year: START_YEAR, tick: 0, yearStartTick: 0, finished: false, bankrupt: false, insolventDays: 0,
    cashCents: a.startingCashCents, cashStartOfYearCents: a.startingCashCents,
    rng: makeRng(cfg.seed), nextVisitId: 1,
    departments: { emergency: dept('emergency', 3, 5, 9), outpatient: dept('outpatient', 3, 4, 4) },
    processLevel: 0, subsidyBudgetCents: 0, subsidyRemainingCents: 0,
    ledger: zeroLedger(), recent: [], yearAcc: freshAcc(), snapshots: [], decisionsThisYear: [],
  };
}

// ---------- scenario indices (all MODEL_ASSUMPTION) ----------
const yrs = (s: SimState) => s.year - START_YEAR;
const idx = (rate: number, n: number) => Math.pow(1 + rate, n);

export class Simulation {
  state: SimState;
  readonly asset: ModelAsset;
  readonly a: Assumptions;
  private models: ServiceMap<ServiceModel> | null = null;
  private modelYear = -1;
  private oopShare: Record<string, number> = {};

  constructor(asset: ModelAsset, state: SimState, assumptions: Assumptions = DEFAULT_ASSUMPTIONS) {
    this.asset = asset; this.state = state; this.a = assumptions;
    for (const svc of PLAYABLE) for (const [py, d] of Object.entries(asset.payments[svc].byPayer)) {
      const fm = d.facilityPaymentCents.mean, om = d.facilityOutOfPocketCents.mean;
      this.oopShare[`${svc}:${py}`] = fm > 0 ? Math.min(1, Math.max(0, om / fm)) : 0;
    }
  }
  static create(asset: ModelAsset, seed: number, assumptions = DEFAULT_ASSUMPTIONS, scenarioId = 'baseline') {
    return new Simulation(asset, createInitialState({ seed, assumptions, scenarioId }), assumptions);
  }

  // ----- population model for the current year -----
  population(): number { return Math.round(this.a.catchmentPopulation.value * idx(this.a.scenario.populationGrowthPerYear, yrs(this.state))); }

  private buildModels() {
    const n = yrs(this.state), sc = this.a.scenario, cells = this.asset.cells;
    const w = cells.map((c) => {
      let f = idx(sc.ageBandGrowthPerYear[c.ageBand] ?? 0, n);
      if (c.payer === 'uninsured') f *= Math.max(0, 1 + sc.uninsuredShareShiftPerYear * n);
      return c.share * f;
    });
    const tw = w.reduce((x, y) => x + y, 0);
    const models = {} as ServiceMap<ServiceModel>;
    for (const svc of PLAYABLE) {
      const cum: number[] = []; let acc = 0, expectedPerPerson = 0;
      cells.forEach((c, i) => { const m = (w[i] / tw) * c.ratesPerPersonYear[svc]; acc += m; cum.push(acc); expectedPerPerson += m; });
      const annual = this.population() * expectedPerPerson * idx(sc.utilizationDriftPerYear, n) * this.a.hospitalShare[svc];
      models[svc] = { cum: cum.map((x) => x + 1e-15), cellIdx: cells.map((_, i) => i), annualEvents: annual };
    }
    this.models = models; this.modelYear = this.state.year;
  }
  /** Expected annual hospital arrivals per service for the current year (before Poisson noise). */
  expectedAnnualArrivals(): ServiceMap<number> {
    if (this.modelYear !== this.state.year) this.buildModels();
    return { emergency: this.models!.emergency.annualEvents, outpatient: this.models!.outpatient.annualEvents };
  }
  /** Shares of arrivals by payer (current-year mix) for the "Why these patients?" panel. */
  payerMix(svc: PlayableService): Record<string, number> {
    if (this.modelYear !== this.state.year) this.buildModels();
    const m = this.models![svc], out: Record<string, number> = {}; let prev = 0;
    const tot = m.cum[m.cum.length - 1];
    this.asset.cells.forEach((c, i) => { out[c.payer] = (out[c.payer] ?? 0) + (m.cum[i] - prev) / tot; prev = m.cum[i]; });
    return out;
  }

  // ----- capacity -----
  postsReal(d: Department): number {
    const st = this.a.staffing[d.service];
    const physCap = d.physicians / (st.fteToCoverPost * st.physiciansPerPost);
    const nurseCap = d.nurses / (st.fteToCoverPost * st.nursesPerPost);
    return Math.max(0, Math.min(d.roomSlots, physCap, nurseCap));
  }
  /** Servers available this tick (deterministic fractional-credit scheme; never negative). */
  private servers(d: Department, hour: number): number {
    const [o, c] = this.a.staffing[d.service].openHours;
    if (hour < o || hour >= c) return 0;
    const real = this.postsReal(d), base = Math.floor(real);
    d.capacityCredit += real - base;
    let extra = 0;
    if (d.capacityCredit >= 1 && base < d.roomSlots) { extra = 1; d.capacityCredit -= 1; } else if (d.capacityCredit >= 1) d.capacityCredit = 0;
    return base + extra;
  }

  // ----- actions -----
  private book(cat: LedgerCategory, cents: number, ref: string) {
    const s = this.state; s.ledger[cat] += cents;
    s.cashCents += cat.startsWith('revenue') ? cents : -cents;
    s.recent.push({ tick: s.tick, category: cat, cents, ref }); if (s.recent.length > RING) s.recent.shift();
  }
  applyAction(act: Action): ActionResult {
    const s = this.state, a = this.a;
    if (s.finished || s.bankrupt) return { ok: false, error: 'Game is over.' };
    const log = (m: string) => s.decisionsThisYear.push(`${s.year}: ${m}`);
    switch (act.type) {
      case 'hire': case 'fire': {
        if (!Number.isInteger(act.count) || act.count <= 0) return { ok: false, error: 'Invalid count.' };
        const d = s.departments[act.service]; const key = act.role === 'nurse' ? 'nurses' : 'physicians';
        const nv = d[key] + (act.type === 'hire' ? act.count : -act.count);
        if (nv < 0) return { ok: false, error: `Cannot go below zero ${act.role}s.` };
        if (nv > a.hiring.maxPerDepartment) return { ok: false, error: 'Hiring cap reached.' };
        d[key] = nv; log(`${act.type} ${act.count} ${act.role}(s) in ${act.service}`); return { ok: true };
      }
      case 'addRoom': {
        const cost = Math.round(a.costs.roomBuildCostCents[act.service] * idx(a.scenario.generalInflationPerYear, yrs(s)));
        if (s.cashCents < cost) return { ok: false, error: `Insufficient funds: need $${(cost / 100).toLocaleString()}.` };
        if (s.departments[act.service].roomSlots >= 20) return { ok: false, error: 'Room limit reached.' };
        this.book('cost.capital', cost, `room:${act.service}`); s.departments[act.service].roomSlots += 1;
        log(`built ${act.service} room`); return { ok: true };
      }
      case 'setProcessLevel': {
        const L = act.level, max = a.costs.processImprovementCostCents.length - 1;
        if (!Number.isInteger(L) || L < 0 || L > max) return { ok: false, error: 'Invalid level.' };
        if (L < s.processLevel) return { ok: false, error: 'Cannot downgrade process improvements.' };
        if (L === s.processLevel) return { ok: true };
        const cost = a.costs.processImprovementCostCents[L] - a.costs.processImprovementCostCents[s.processLevel];
        if (s.cashCents < cost) return { ok: false, error: `Insufficient funds: need $${(cost / 100).toLocaleString()}.` };
        this.book('cost.process', cost, `process:L${L}`); s.processLevel = L; log(`process improvement level ${L}`); return { ok: true };
      }
      case 'setSubsidy': {
        if (!Number.isInteger(act.budgetCents) || act.budgetCents < 0) return { ok: false, error: 'Invalid budget.' };
        s.subsidyBudgetCents = act.budgetCents; s.subsidyRemainingCents = act.budgetCents;
        log(`financial assistance fund $${(act.budgetCents / 100).toLocaleString()}/yr`); return { ok: true };
      }
    }
  }

  // ----- sampling -----
  /** Inverse-CDF sample from the exported quantile grid. Body: linear interpolation. Top 5%: power curve between q95 and max
   *  whose mean equals the exported weighted tail mean, so heavy tails do not inflate the overall mean. */
  private sampleDist(r: RngState, p: PaymentDist): number {
    const q = p.quantiles, g = p.quantileGrid, u = next(r), last = g.length - 1;
    if (u >= g[last - 1]) {
      const lo = q[last - 1], hi = q[last], t = (u - g[last - 1]) / (g[last] - g[last - 1]);
      const tm = p.tailMean ?? (lo + hi) / 2;
      const k = tm > lo ? Math.max(0, (hi - lo) / (tm - lo) - 1) : 0;
      return Math.max(0, Math.round(lo + (hi - lo) * Math.pow(t, k)));
    }
    let i = 0; while (i < g.length - 2 && g[i + 1] < u) i++;
    const t = (u - g[i]) / (g[i + 1] - g[i]);
    return Math.max(0, Math.round(q[i] + (q[i + 1] - q[i]) * t));
  }
  private makeVisit(svc: PlayableService): Visit {
    const s = this.state, r = s.rng, m = this.models![svc];
    const cell = this.asset.cells[pickCumulative(r, m.cum)];
    const ageHi = cell.ageBand === '65+' ? 90 : Number(cell.ageBand.split('-')[1]), ageLo = cell.ageBand === '65+' ? 65 : Number(cell.ageBand.split('-')[0]);
    const age = ageLo + Math.floor(next(r) * (ageHi - ageLo + 1));
    const sevW = this.a.treatment.severityWeights; let u = next(r), sev = 0;
    while (sev < sevW.length - 1 && u >= sevW[sev]) { u -= sevW[sev]; sev++; }
    const hours = svc === 'emergency' ? this.a.treatment.emergencyHoursBySeverity : this.a.treatment.outpatientHoursBySeverity;
    const dist: EventDist = this.asset.payments[svc].byPayer[cell.payer] ?? this.asset.payments[svc].pooled;
    const price = idx(this.a.scenario.medicalPriceInflationPerYear, yrs(s));
    const pay = Math.round(this.sampleDist(r, dist.facilityPaymentCents) * price);
    const oop = Math.min(pay, Math.round(pay * (this.oopShare[`${svc}:${cell.payer}`] ?? 0)));
    const id = `V${s.nextVisitId++}`;
    const patient: SyntheticPatient = { id: `P${id}`, age, payer: cell.payer, incomeBand: cell.incomeBand, riskBand: `severity-${sev + 1}`,
      cohortId: `${cell.ageBand}|${cell.payer}|${cell.incomeBand}`, isDemo: this.asset.provenanceKind === 'DEMO_SYNTHETIC' };
    return { id, patientId: patient.id, service: svc, arrivalTick: s.tick, treatmentTicks: hours[sev], severityBand: sev + 1,
      expectedFacilityPaymentCents: pay, expectedOutOfPocketCents: oop, source: this.asset.provenanceKind, patient };
  }

  // ----- stepping -----
  /** Advance n ticks (1 tick = 1 hour). Stops early at year end if stopAtYearEnd. Returns ticks run and whether a year closed. */
  advance(n: number, opts: { onEvent?: (e: SimEvent) => void; stopAtYearEnd?: boolean } = {}): { ticksRun: number; yearClosed: boolean } {
    const s = this.state, a = this.a, emit = opts.onEvent;
    let ran = 0, closed = false;
    while (ran < n && !s.finished && !s.bankrupt) {
      if (this.modelYear !== s.year) this.buildModels();
      const hour = s.tick % 24;
      // 1. completions
      for (const svc of PLAYABLE) {
        const d = s.departments[svc], still: ActiveVisit[] = [];
        for (const av of d.inService) {
          if (av.endTick <= s.tick) this.complete(av, emit); else still.push(av);
        }
        d.inService = still;
      }
      // 2. arrivals
      for (const svc of PLAYABLE) {
        const lam = (this.models![svc].annualEvents / 365) * profileFor(svc, a)[hour];
        const k = poisson(s.rng, lam);
        for (let i = 0; i < k; i++) {
          const v = this.makeVisit(svc); s.departments[svc].queue.push(v);
          s.yearAcc.arrivals[svc]++; grp(s.yearAcc, v).forEach((g) => g.arrivals++); emit?.({ type: 'arrive', tick: s.tick, visit: v });
        }
      }
      // 3. service starts (FIFO)
      const mult = a.costs.processImprovementServiceTimeMultiplier[s.processLevel] ?? 1;
      for (const svc of PLAYABLE) {
        const d = s.departments[svc]; let free = this.servers(d, hour) - d.inService.length;
        while (free > 0 && d.queue.length > 0) {
          const v = d.queue.shift()!; const dur = Math.max(1, Math.round(v.treatmentTicks * mult));
          d.inService.push({ visit: v, startTick: s.tick, endTick: s.tick + dur }); free--;
          const wait = s.tick - v.arrivalTick; s.yearAcc.waitSum[svc] += wait; grp(s.yearAcc, v).forEach((g) => (g.waitTicksSum += wait));
          emit?.({ type: 'start', tick: s.tick, visit: v, waitTicks: wait });
        }
        // 4. unmet demand: transfer / left without being seen after waiting too long
        const lim = svc === 'emergency' ? a.queue.emergencyDiversionWaitTicks : a.queue.outpatientLeaveWaitTicks;
        const keep: Visit[] = [];
        for (const v of d.queue) {
          if (s.tick - v.arrivalTick >= lim) {
            s.yearAcc.unmet[svc]++; grp(s.yearAcc, v).forEach((g) => g.unmet++);
            emit?.({ type: 'leave', tick: s.tick, visit: v, reason: svc === 'emergency' ? 'diverted' : 'left_unseen' });
          } else keep.push(v);
        }
        d.queue = keep;
      }
      // 5. daily costs at midnight
      if (hour === 0 && s.tick > s.yearStartTick) this.dailyCosts();
      s.tick++; ran++;
      // 6. year end
      if (s.tick - s.yearStartTick >= a.hoursPerYear) {
        this.closeYear(); closed = true;
        if (opts.stopAtYearEnd) break;
      }
    }
    return { ticksRun: ran, yearClosed: closed };
  }

  private complete(av: ActiveVisit, emit?: (e: SimEvent) => void) {
    const s = this.state, v = av.visit, svc = v.service as PlayableService;
    this.book(`revenue.${svc}` as LedgerCategory, v.expectedFacilityPaymentCents, v.id);
    const vc = Math.round(this.a.costs.variableCostPerEncounterCents[svc] * idx(this.a.scenario.generalInflationPerYear, yrs(s)));
    this.book('cost.variable', vc, v.id);
    // financial assistance: forgive eligible patient OOP up to the fund; transparent transfer, recorded as cost.subsidy
    let forgiven = 0;
    const eligible = v.patient.payer === 'uninsured' || v.patient.incomeBand === '<200%FPL';
    if (eligible && s.subsidyRemainingCents > 0 && v.expectedOutOfPocketCents > 0) {
      forgiven = Math.min(v.expectedOutOfPocketCents, s.subsidyRemainingCents);
      s.subsidyRemainingCents -= forgiven; this.book('cost.subsidy', forgiven, v.id);
    }
    const oop = v.expectedOutOfPocketCents - forgiven;
    s.yearAcc.treated[svc]++; s.yearAcc.oop += oop; s.yearAcc.subsidized += forgiven;
    grp(s.yearAcc, v).forEach((g) => { g.treated++; g.oopCents += oop; g.subsidizedOopCents += forgiven; });
    emit?.({ type: 'complete', tick: s.tick, visit: v, revenueCents: v.expectedFacilityPaymentCents });
  }

  private dailyCosts() {
    const s = this.state, c = this.a.costs, sc = this.a.scenario, n = yrs(s);
    let staffCost = 0, upkeep = 0;
    for (const svc of PLAYABLE) {
      const d = s.departments[svc];
      staffCost += d.physicians * c.physicianSalaryCents + d.nurses * c.nurseSalaryCents;
      upkeep += d.roomSlots * c.roomUpkeepPerYearCents[svc];
    }
    this.book('cost.payroll', Math.round((staffCost * idx(sc.wageInflationPerYear, n)) / 365), 'payroll');
    this.book('cost.upkeep', Math.round((upkeep * idx(sc.generalInflationPerYear, n)) / 365), 'upkeep');
    this.book('cost.overhead', Math.round((c.overheadPerYearCents * idx(sc.generalInflationPerYear, n)) / 365), 'overhead');
    const pu = c.processImprovementUpkeepCents[s.processLevel];
    if (pu > 0) this.book('cost.process', Math.round((pu * idx(sc.generalInflationPerYear, n)) / 365), 'process-upkeep');
    if (s.cashCents < 0) { if (++s.insolventDays > 60) s.bankrupt = true; } else s.insolventDays = 0;
  }

  private closeYear() {
    const s = this.state, acc = s.yearAcc;
    const rev = s.ledger['revenue.emergency'] + s.ledger['revenue.outpatient'];
    const exp = LEDGER_CATEGORIES.filter((k) => k.startsWith('cost.')).reduce((t, k) => t + s.ledger[k], 0);
    const treatedAll = acc.treated.emergency + acc.treated.outpatient;
    const waitAll = acc.waitSum.emergency + acc.waitSum.outpatient;
    const dep = s.departments;
    const snap: AnnualSnapshot = {
      year: s.year, seed: s.config.seed, modelVersion: this.asset.modelVersion, mode: this.asset.provenanceKind,
      populationSize: this.population(),
      arrivals: { emergency: acc.arrivals.emergency, outpatient: acc.arrivals.outpatient, inpatient: 0 },
      treated: { emergency: acc.treated.emergency, outpatient: acc.treated.outpatient, inpatient: 0 },
      unmet: { emergency: acc.unmet.emergency, outpatient: acc.unmet.outpatient, inpatient: 0 },
      avgWaitTicks: treatedAll ? waitAll / treatedAll : 0,
      avgWaitTicksByService: { emergency: acc.treated.emergency ? acc.waitSum.emergency / acc.treated.emergency : 0,
        outpatient: acc.treated.outpatient ? acc.waitSum.outpatient / acc.treated.outpatient : 0 },
      revenueCents: rev, expensesCents: exp, netCents: rev - exp,
      cashStartCents: s.cashStartOfYearCents, cashCents: s.cashCents, ledger: { ...s.ledger },
      staffCount: dep.emergency.nurses + dep.emergency.physicians + dep.outpatient.nurses + dep.outpatient.physicians,
      roomCount: dep.emergency.roomSlots + dep.outpatient.roomSlots,
      physicians: dep.emergency.physicians + dep.outpatient.physicians, nurses: dep.emergency.nurses + dep.outpatient.nurses,
      unmetDemand: acc.unmet.emergency + acc.unmet.outpatient,
      byPayer: acc.byPayer, byIncome: acc.byIncome, patientOopCents: acc.oop, subsidizedOopCents: acc.subsidized,
      avgOopPerVisitCents: treatedAll ? Math.round(acc.oop / treatedAll) : 0,
      decisions: [...s.decisionsThisYear],
      provenance: [...assetProvenance(this.asset),
        { kind: 'MODEL_ASSUMPTION', sourceId: 'default-assumptions.json', method: 'Hospital share, staffing, unit costs, scenario drift', assumptions: ['Not survey findings'] },
        { kind: 'SIMULATED', sourceId: 'sim', method: 'Queue/capacity outcomes after player decisions' }],
    };
    s.snapshots.push(snap);
    if (s.year >= END_YEAR) { s.finished = true; return; }
    // transition
    s.year++; s.yearStartTick = s.tick; s.cashStartOfYearCents = s.cashCents; s.ledger = zeroLedger(); s.yearAcc = freshAcc(); s.decisionsThisYear = [];
    s.subsidyRemainingCents = s.subsidyBudgetCents;
  }

  /** Fast-forward to the end of the current year (or the end of the game). */
  runToYearEnd(): void { const y = this.state.year; while (!this.state.finished && !this.state.bankrupt && this.state.year === y) this.advance(this.a.hoursPerYear, { stopAtYearEnd: true }); }
  runToEnd(): void { while (!this.state.finished && !this.state.bankrupt) this.runToYearEnd(); }

  /** Invariant check: cash_end == cash_start + revenue - costs for the in-progress year. */
  checkInvariants(): string[] {
    const s = this.state, errs: string[] = [];
    const rev = s.ledger['revenue.emergency'] + s.ledger['revenue.outpatient'];
    const cost = LEDGER_CATEGORIES.filter((k) => k.startsWith('cost.')).reduce((t, k) => t + s.ledger[k], 0);
    if (s.cashCents !== s.cashStartOfYearCents + rev - cost) errs.push('cash != start + revenue - costs');
    for (const svc of PLAYABLE) {
      const d = s.departments[svc];
      if (d.roomSlots < 0 || d.nurses < 0 || d.physicians < 0) errs.push(`${svc}: negative capacity`);
      if (!Number.isInteger(s.cashCents)) errs.push('cash not integer cents');
    }
    return errs;
  }
}

function grp(acc: YearAcc, v: Visit): GroupStats[] {
  const p = (acc.byPayer[v.patient.payer] ??= gs()), i = (acc.byIncome[v.patient.incomeBand] ??= gs());
  return [p, i];
}
export function serialize(s: SimState): string { return JSON.stringify(s); }
export function deserialize(json: string): SimState {
  const s = JSON.parse(json) as SimState;
  if (s?.version !== 1 || !s.departments || !s.rng) throw new Error('Corrupt or incompatible save.');
  return s;
}
export type { PayerGroup };
