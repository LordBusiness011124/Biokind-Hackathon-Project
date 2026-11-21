import { describe, expect, it } from 'vitest';
import { CARDS, END_YEAR, Simulation, describeOption, getCard, makeRng, next, scorecard, type SimEvent, replay, summarize, buildQuestions, coachTips, makeDemoAsset, serialize, validateAsset, type Action } from '../src';
import { loadAsset } from './helpers';

const asset = loadAsset();

describe('real MEPS asset', () => {
  it('is MEPS_CALIBRATED and valid', () => {
    expect(asset.provenanceKind).toBe('MEPS_CALIBRATED');
    expect(asset.counts.personsPositiveWeight).toBe(18683);
  });
  it('rejects malformed assets', () => {
    expect(() => validateAsset({})).toThrow();
    expect(() => validateAsset({ ...asset, cells: [] })).toThrow();
  });
});

describe('reproducibility', () => {
  it('same seed + actions => identical serialized state', () => {
    const run = () => {
      const s = Simulation.create(asset, 42);
      s.applyAction({ type: 'hire', service: 'emergency', role: 'physician', count: 2 });
      s.advance(3000); s.applyAction({ type: 'addRoom', service: 'outpatient' }); s.advance(6000);
      return serialize(s.state);
    };
    expect(run()).toBe(run());
  });
  it('different seeds differ', () => {
    const a = Simulation.create(asset, 1); a.advance(2000);
    const b = Simulation.create(asset, 2); b.advance(2000);
    expect(serialize(a.state)).not.toBe(serialize(b.state));
  });
  it('demand is the same until trust diverges: staffing choices cannot change arrivals within the first month', () => {
    const a = Simulation.create(asset, 7), b = Simulation.create(asset, 7);
    b.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 6 });
    b.applyAction({ type: 'setProcessLevel', level: 2 });
    a.advance(700); b.advance(700);
    expect(a.state.yearAcc.arrivals).toEqual(b.state.yearAcc.arrivals);
  });
});

describe('invariants', () => {
  it('cash identity and non-negativity hold through a year', () => {
    const s = Simulation.create(asset, 3);
    for (let i = 0; i < 20; i++) { s.advance(500); expect(s.checkInvariants()).toEqual([]); }
  });
  it('no duplicate billing: revenue entries unique per visit', () => {
    const s = Simulation.create(asset, 5); s.advance(4000);
    const refs = s.state.recent.filter((e) => e.category.startsWith('revenue')).map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
  it('rejects bad actions', () => {
    const s = Simulation.create(asset, 1);
    expect(s.applyAction({ type: 'fire', service: 'emergency', role: 'nurse', count: 999 }).ok).toBe(false);
    expect(s.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 0 }).ok).toBe(false);
    s.state.cashCents = 0;
    expect(s.applyAction({ type: 'addRoom', service: 'emergency' }).ok).toBe(false);
    expect(s.state.departments.emergency.roomSlots).toBe(3);
  });
  it('more staff does not reduce throughput (same seed)', () => {
    const base = Simulation.create(asset, 11), more = Simulation.create(asset, 11);
    base.state.cashCents = more.state.cashCents = 10 ** 10;
    more.applyAction({ type: 'hire', service: 'emergency', role: 'physician', count: 5 });
    more.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 9 });
    base.runToYearEnd(); more.runToYearEnd();
    expect(more.state.snapshots[0].treated.emergency).toBeGreaterThanOrEqual(base.state.snapshots[0].treated.emergency);
  });
});

describe('stress', () => {
  it('no staff: nothing treated, all arrivals become unmet, no NaN', () => {
    const s = Simulation.create(asset, 9); s.state.cashCents = 10 ** 12;
    for (const sv of ['emergency', 'outpatient'] as const) { s.state.departments[sv].nurses = 0; s.state.departments[sv].physicians = 0; }
    s.runToYearEnd(); const y = s.state.snapshots[0];
    expect(y.treated.emergency + y.treated.outpatient).toBe(0);
    expect(Number.isFinite(y.avgWaitTicks)).toBe(true);
  });
  it('zero catchment => zero arrivals', () => {
    const a = structuredClone(Simulation.create(asset, 1).a); a.catchmentPopulation.value = 0;
    const s = Simulation.create(asset, 1, a); s.state.cashCents = 10 ** 12; s.runToYearEnd();
    expect(s.state.snapshots[0].arrivals.emergency).toBe(0);
  });
  it('bankrupt hospital halts', () => {
    const s = Simulation.create(asset, 1); s.state.cashCents = -10_000_000_000; s.runToEnd();
    expect(s.state.bankrupt).toBe(true); expect(s.state.finished).toBe(false);
  });
  it('demo asset runs and is flagged DEMO_SYNTHETIC', () => {
    const d = makeDemoAsset(); validateAsset(d);
    const s = Simulation.create(d, 1); s.state.cashCents = 10 ** 12; s.runToYearEnd();
    expect(s.state.snapshots[0].mode).toBe('DEMO_SYNTHETIC');
  });
});

describe('20-year run', () => {
  it('completes 2024..2044 with 21 snapshots, no NaN, invariants hold', () => {
    const s = Simulation.create(asset, 2044, { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 }); s.runToEnd();
    expect(s.state.finished).toBe(true);
    expect(s.state.snapshots.length).toBe(21);
    expect(s.state.snapshots[0].year).toBe(2024); expect(s.state.snapshots[20].year).toBe(END_YEAR);
    expect(JSON.stringify(s.state.snapshots.map(({ event: _e, ...r }) => r))).not.toMatch(/NaN|null/);
    for (const sn of s.state.snapshots) expect(sn.cashCents).toBe(sn.cashStartCents + sn.revenueCents - sn.expensesCents);
    expect(s.state.snapshots[0].cashStartCents + s.state.snapshots.reduce((t, x) => t + x.netCents, 0)).toBe(s.state.cashCents);
  });
});

describe('payment calibration', () => {
  it('simulated mean facility payment per ER visit tracks the MEPS-derived payer-mix mean (heavy tail not inflated)', () => {
    const s = Simulation.create(asset, 99);
    for (const sv of ['emergency', 'outpatient'] as const) { s.state.departments[sv].physicians = 40; s.state.departments[sv].nurses = 40; s.state.departments[sv].roomSlots = 20; }
    s.state.cashCents = 10 ** 13; s.runToYearEnd();
    const y = s.state.snapshots[0];
    const mix = s.payerMix('emergency');
    const expected = Object.entries(mix).reduce((t, [p, sh]) => t + sh * asset.payments.emergency.byPayer[p].facilityPaymentCents.mean, 0);
    const simulated = y.ledger['revenue.emergency'] / y.treated.emergency;
    expect(simulated / expected).toBeGreaterThan(0.75);
    expect(simulated / expected).toBeLessThan(1.25);
  });
});

describe('inpatient ward', () => {
  it('is locked at start (0 beds) and treats nothing until built and staffed', () => {
    const s = Simulation.create(asset, 4); s.runToYearEnd();
    expect(s.state.snapshots[0].treated.inpatient).toBe(0);
    expect(s.state.snapshots[0].arrivals.inpatient).toBeGreaterThan(0);
  });
  it('built + staffed ward treats admissions and books inpatient revenue', () => {
    const s = Simulation.create(asset, 4); s.state.cashCents = 10 ** 10;
    for (let i = 0; i < 8; i++) expect(s.applyAction({ type: 'addRoom', service: 'inpatient' }).ok).toBe(true);
    s.applyAction({ type: 'hire', service: 'inpatient', role: 'physician', count: 6 });
    s.applyAction({ type: 'hire', service: 'inpatient', role: 'nurse', count: 12 });
    s.runToYearEnd(); const y = s.state.snapshots[0];
    expect(y.treated.inpatient).toBeGreaterThan(50);
    expect(y.ledger['revenue.inpatient']).toBeGreaterThan(0);
    expect(s.checkInvariants()).toEqual([]);
  });
});

describe('replay & bands', () => {
  it('replaying the action log with the same seed reproduces the run exactly', () => {
    const rich = { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 10 };
    const a = Simulation.create(asset, 21, rich);
    a.applyAction({ type: 'hire', service: 'emergency', role: 'physician', count: 3 }); a.advance(2500);
    a.applyAction({ type: 'addRoom', service: 'emergency' }); a.advance(8760 * 2); a.runToYearEnd();
    const n = a.state.snapshots.length;
    const b = replay(asset, 21, a.state.actionLog, n, rich);
    expect(b.state.snapshots.length).toBe(n);
    expect(JSON.stringify(b.state.snapshots)).toBe(JSON.stringify(a.state.snapshots));
  });
  it('summary bands are ordered', () => {
    const runs = [1, 2, 3, 4, 5].map((sd) => replay(asset, sd, [], 2)); const b = summarize(runs);
    expect(b.finalCash.p10).toBeLessThanOrEqual(b.finalCash.median); expect(b.finalCash.median).toBeLessThanOrEqual(b.finalCash.p90);
  });
});

describe('MEPS teaching layer', () => {
  it('questions are derived from the asset: exactly one correct answer index, in range, deterministic', () => {
    for (let y = 2024; y <= 2044; y++) {
      const qs = buildQuestions(asset, y, 2), again = buildQuestions(asset, y, 2);
      expect(qs.length).toBe(2); expect(qs).toEqual(again);
      for (const q of qs) { expect(q.answerIndex).toBeGreaterThanOrEqual(0); expect(q.answerIndex).toBeLessThan(q.options.length); expect(q.explain.length).toBeGreaterThan(20); expect(new Set(q.options).size).toBe(q.options.length); }
    }
  });
  it('known MEPS facts come out right (top-10% spending, 65+ highest inpatient use)', () => {
    const all = Array.from({ length: 40 }, (_, i) => buildQuestions(asset, 2024 + (i % 21), 2)).flat();
    const top = all.find((q) => q.id === 'top10-spend')!; expect(top.options[top.answerIndex]).toBe('50% to 70%');
    const age = all.find((q) => q.id === 'max-ageBand-inpatient'); if (age) expect(age.options[age.answerIndex]).toBe('65+');
  });
  it('demo asset yields no questions and a demo coach tip', () => {
    const d = makeDemoAsset(); expect(buildQuestions(d, 2024)).toEqual([]);
    expect(coachTips(Simulation.create(d, 1))[0].id).toBe('demo');
  });
  it('coach flags the closed ward and under-staffed ER at the default start, citing MEPS', () => {
    const tips = coachTips(Simulation.create(asset, 1)); expect(tips.some((t) => t.id === 'ward-closed')).toBe(true);
    expect(tips.every((t) => t.meps.length > 10)).toBe(true);
  });
  it('grant action books revenue.grant, is capped, and keeps the cash identity', () => {
    const s = Simulation.create(asset, 1); const c0 = s.state.cashCents;
    expect(s.applyAction({ type: 'grant', cents: 2_500_000, reason: 'quiz' }).ok).toBe(true);
    expect(s.applyAction({ type: 'grant', cents: 99_999_999, reason: 'x' }).ok).toBe(false);
    expect(s.state.cashCents).toBe(c0 + 2_500_000); expect(s.checkInvariants()).toEqual([]);
  });
});

describe('challenge events & scorecard', () => {
  it('events are off by default and identical regardless of decisions; seeded per year', () => {
    const off = Simulation.create(asset, 5, undefined, 'x', false); off.runToEnd();
    expect(off.state.snapshots.every((s) => s.event === null)).toBe(true);
    const mk = (act: boolean) => { const s = Simulation.create(asset, 12, { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 }, 'x', true); if (act) s.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 5 }); s.runToEnd(); return s.state.snapshots.map((x) => x.event); };
    expect(mk(false)).toEqual(mk(true)); expect(mk(false).some((e) => e !== null)).toBe(true);
  });
  it('an event changes demand in its year (flu raises arrivals) without breaking invariants', () => {
    const rich = { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 };
    for (let seed = 1; seed < 60; seed++) {
      const on = Simulation.create(asset, seed, rich, 'x', true); on.runToEnd(); const base = Simulation.create(asset, seed, rich, 'x', false); base.runToEnd();
      const i = on.state.snapshots.findIndex((s) => s.event === 'Severe flu season'); if (i < 0) continue;
      expect(on.state.snapshots[i].arrivals.emergency).toBeGreaterThan(base.state.snapshots[i].arrivals.emergency * 1.05); return;
    }
    throw new Error('no flu season found in 60 seeds');
  });
  it('scorecard: bankrupt scores 0 on finance and weights sum to a 0-100 total with a letter grade', () => {
    const s = Simulation.create(asset, 1); s.runToEnd();
    const sc = scorecard(s.state.snapshots, s.a, { bankrupt: s.state.bankrupt, finished: s.state.finished, dataIq: { asked: 4, correct: 3 } });
    expect(sc.objectives.length).toBe(7); expect(sc.total).toBeGreaterThanOrEqual(0); expect(sc.total).toBeLessThanOrEqual(100); expect('ABCDF').toContain(sc.grade);
    expect(sc.objectives.find((o) => o.id === 'finance')!.score).toBe(s.state.bankrupt ? 0 : sc.objectives.find((o) => o.id === 'finance')!.score);
  });
  it('a sensible strategy out-scores doing nothing', () => {
    const rich = { ...Simulation.create(asset, 1).a, startingCashCents: 300000000 };
    const nothing = Simulation.create(asset, 3, rich); nothing.runToEnd();
    const good = Simulation.create(asset, 3, rich);
    good.applyAction({ type: 'fire', service: 'outpatient', role: 'physician', count: 1 }); good.applyAction({ type: 'fire', service: 'outpatient', role: 'nurse', count: 1 });
    for (let i = 0; i < 6; i++) good.applyAction({ type: 'addRoom', service: 'inpatient' });
    good.applyAction({ type: 'hire', service: 'inpatient', role: 'physician', count: 5 }); good.applyAction({ type: 'hire', service: 'inpatient', role: 'nurse', count: 9 }); good.runToEnd();
    const sc = (x: Simulation) => scorecard(x.state.snapshots, x.a, { bankrupt: x.state.bankrupt, finished: x.state.finished, dataIq: { asked: 0, correct: 0 } }).total;
    expect(sc(good)).toBeGreaterThan(sc(nothing));
  });
});

describe('coach one-click suggestions', () => {
  it('the closed-ward and clinic-trim suggestions apply cleanly and then disappear from the advice', () => {
    const s = Simulation.create(asset, 1);
    const tips = coachTips(s); const ward = tips.find((t) => t.id === 'ward-closed')!, trim = coachTips(s).find((t) => t.id === 'op-over');
    expect(ward.apply!.actions.every((a) => s.applyAction(a).ok)).toBe(true);
    if (trim) expect(trim.apply!.actions.every((a) => s.applyAction(a).ok)).toBe(true);
    expect(s.state.departments.inpatient.roomSlots).toBe(6);
    expect(coachTips(s).some((t) => t.id === 'ward-closed')).toBe(false);
    expect(s.checkInvariants()).toEqual([]);
  });
});

describe('bug regressions', () => {
  it('re-selecting the same assistance fund level does not refill it mid-year', () => {
    const s = Simulation.create(asset, 8, { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 });
    s.applyAction({ type: 'setSubsidy', budgetCents: 10_000_000 }); s.advance(1500);
    const left = s.state.subsidyRemainingCents; expect(left).toBeLessThan(10_000_000);
    s.applyAction({ type: 'setSubsidy', budgetCents: 10_000_000 }); expect(s.state.subsidyRemainingCents).toBe(left);
    s.applyAction({ type: 'setSubsidy', budgetCents: 12_000_000 }); expect(s.state.subsidyRemainingCents).toBe(left + 2_000_000);
    s.applyAction({ type: 'setSubsidy', budgetCents: 0 }); expect(s.state.subsidyRemainingCents).toBe(0);
  });
  it('payroll is charged for all 365 days of every year', () => {
    const s = Simulation.create(asset, 2, { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 });
    const c = s.a.costs, annual = Object.values(s.state.departments).reduce((t, d) => t + d.physicians * c.physicianSalaryCents + d.nurses * c.nurseSalaryCents, 0);
    s.runToYearEnd(); expect(Math.abs(s.state.snapshots[0].ledger['cost.payroll'] - annual)).toBeLessThanOrEqual(365);
  });
  it('a hospital that goes bankrupt in its first year still produces a snapshot for the game-over screen', () => {
    const s = Simulation.create(asset, 1); s.state.cashCents = -10_000_000_000; s.runToEnd();
    expect(s.state.bankrupt).toBe(true); expect(s.state.snapshots.length).toBe(1);
    expect(s.state.snapshots[0].year).toBe(2024); expect(s.state.snapshots[0].cashCents).toBeLessThan(0);
    s.advance(100); expect(s.state.snapshots.length).toBe(1);   // no duplicate partial snapshots
  });
});

describe('randomised stress', () => {
  it('random decisions over many seeds never break money, capacity or queue invariants', () => {
    const rich = { ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 };
    for (let seed = 1; seed <= 10; seed++) {
      const s = Simulation.create(asset, seed, rich, 'fuzz', seed % 2 === 0), r = makeRng(seed * 977);
      const pick = <T,>(xs: T[]) => xs[Math.floor(next(r) * xs.length)];
      while (!s.state.finished && !s.state.bankrupt && s.state.tick < 8760 * 6) {
        const svc = pick(['emergency', 'outpatient', 'inpatient'] as const);
        s.applyAction(pick<Action>([
          { type: 'hire', service: svc, role: 'nurse', count: 1 + Math.floor(next(r) * 4) }, { type: 'fire', service: svc, role: 'physician', count: 1 },
          { type: 'addRoom', service: svc }, { type: 'setProcessLevel', level: Math.floor(next(r) * 4) }, { type: 'setSubsidy', budgetCents: Math.floor(next(r) * 3) * 10_000_000 },
        ]));
        s.advance(1 + Math.floor(next(r) * 1500));
        expect(s.checkInvariants()).toEqual([]);
        for (const d of Object.values(s.state.departments)) {
          expect(d.queue.every((v, i) => i === 0 || d.queue[i - 1].arrivalTick <= v.arrivalTick)).toBe(true);   // FIFO order, relied on by the timeout logic
          expect(d.inService.length).toBeLessThanOrEqual(Math.max(d.roomSlots, 0) + 1);
        }
        const refs = s.state.recent.filter((e) => e.category.startsWith('revenue.') && e.category !== 'revenue.grant').map((e) => e.ref);
        expect(new Set(refs).size).toBe(refs.length);
      }
      expect(JSON.stringify(s.state.snapshots.map(({ event: _e, ...x }) => x))).not.toMatch(/NaN|Infinity|null/);
    }
  });
});


describe('decisions, policies and trust', () => {
  const rich = () => ({ ...Simulation.create(asset, 1).a, startingCashCents: 10 ** 11 });

  it('every option of every card applies cleanly in several years and keeps the books balanced', () => {
    for (const card of CARDS) for (const opt of card.options) for (const year of [0, 3, 9]) {
      const s = Simulation.create(asset, 5 + year, rich());
      for (let y = 0; y < year; y++) s.runToYearEnd();
      s.state.pendingCard = { cardId: card.id, year: s.state.year };   // force this card regardless of the draw
      const r = s.applyAction({ type: 'decide', cardId: card.id, optionId: opt.id });
      expect(r.ok, `${card.id}/${opt.id}`).toBe(true);
      expect(s.state.pendingCard).toBeNull(); expect(s.state.decisionLog.at(-1)!.optionId).toBe(opt.id);
      expect(s.checkInvariants()).toEqual([]); s.runToYearEnd();
      expect(JSON.stringify(s.state.snapshots.map(({ event: _e, ...x }) => x))).not.toMatch(/NaN|Infinity|null/);
      expect(Array.isArray(describeOption(opt).effects)).toBe(true);   // may be empty for a do-nothing option
    }
  });
  it('a dilemma is waiting from the start, is deterministic for a seed, and can only be answered once', () => {
    const a = Simulation.create(asset, 11), b = Simulation.create(asset, 11);
    expect(a.state.pendingCard).not.toBeNull(); expect(a.state.pendingCard).toEqual(b.state.pendingCard);
    const card = getCard(a.state.pendingCard!.cardId)!, first = card.options[0].id;
    expect(a.applyAction({ type: 'decide', cardId: 'nope', optionId: first }).ok).toBe(false);
    a.state.cashCents = Math.max(a.state.cashCents, card.options[0].upfrontCents);
    expect(a.applyAction({ type: 'decide', cardId: card.id, optionId: first }).ok).toBe(true);
    expect(a.applyAction({ type: 'decide', cardId: card.id, optionId: first }).ok).toBe(false);
  });
  it('rejects an option the hospital cannot afford', () => {
    const s = Simulation.create(asset, 3); const card = CARDS.find((c) => c.id === 'imaging')!; s.state.pendingCard = { cardId: card.id, year: 2024 };
    s.state.cashCents = 1000; expect(s.applyAction({ type: 'decide', cardId: 'imaging', optionId: 'buy' }).ok).toBe(false); expect(s.state.pendingCard).not.toBeNull();
  });
  it('leaving a dilemma unanswered defers it to its default option, recorded as deferred, and a new one arrives', () => {
    const s = Simulation.create(asset, 4, rich()); const first = s.state.pendingCard!.cardId; s.runToYearEnd();
    const e = s.state.decisionLog[0]; expect(e.cardId).toBe(first); expect(e.deferred).toBe(true); expect(e.optionId).toBe(getCard(first)!.defaultOptionId);
    expect(s.state.pendingCard).not.toBeNull(); expect(s.state.pendingCard!.year).toBe(2025);
  });
  it('seeded setbacks are the same for the same seed, so comparisons stay fair', () => {
    const run = () => { const s = Simulation.create(asset, 9, rich()); s.state.pendingCard = { cardId: 'nurse-contract', year: 2024 }; s.applyAction({ type: 'decide', cardId: 'nurse-contract', optionId: 'hold' }); return s.state.decisionLog[0].failed; };
    expect(run()).toBe(run());
  });
  it('a payment-cut modifier lowers Medicaid payments, then expires', () => {
    const base = Simulation.create(asset, 6, rich()), cut = Simulation.create(asset, 6, rich());
    cut.state.pendingCard = { cardId: 'medicaid-cut', year: 2024 }; cut.applyAction({ type: 'decide', cardId: 'medicaid-cut', optionId: 'absorb' });
    expect(cut.state.modifiers.length).toBe(1); expect(cut.state.modifiers[0].untilYear).toBe(2027);
    base.advance(2000); cut.advance(2000);
    const avg = (x: Simulation) => { const g = x.state.yearAcc.byPayer.medicaid; return g.treated ? (x.state.ledger['revenue.emergency'] + x.state.ledger['revenue.outpatient']) / Math.max(1, x.state.yearAcc.treated.emergency + x.state.yearAcc.treated.outpatient) : 0; };
    expect(avg(cut)).toBeLessThan(avg(base));
    for (let y = 0; y < 4; y++) cut.runToYearEnd();
    expect(cut.state.modifiers.some((m) => m.label === 'State Medicaid rate cut')).toBe(false);
  });
  it('limiting elective Medicaid/uninsured access turns patients away from the clinic and ward but never the ER', () => {
    const open = Simulation.create(asset, 8, rich()), lim = Simulation.create(asset, 8, rich());
    for (const s of [open, lim]) { s.state.departments.inpatient.roomSlots = 6; s.state.departments.inpatient.physicians = 5; s.state.departments.inpatient.nurses = 9; }
    lim.applyAction({ type: 'setPolicy', medicaidAccess: 'limited' });
    let declinedEr = 0, declinedOther = 0; const seen = (e: SimEvent) => { if (e.type === 'leave' && e.reason === 'declined') { if (e.visit.service === 'emergency') declinedEr++; else declinedOther++; } };
    open.advance(690); lim.advance(690, { onEvent: seen });
    expect(declinedEr).toBe(0); expect(declinedOther).toBeGreaterThan(5);
    expect(lim.state.yearAcc.unmet.outpatient).toBeGreaterThan(open.state.yearAcc.unmet.outpatient);
    expect(Math.abs(lim.state.yearAcc.arrivals.emergency / open.state.yearAcc.arrivals.emergency - 1)).toBeLessThan(0.25);   // ER demand only moves through the small trust effect
    expect(lim.state.reputation).toBeLessThan(open.state.reputation);
  });
  it('trust follows service quality: an unstaffed hospital loses trust, a well-run one gains it, and demand follows', () => {
    const bad = Simulation.create(asset, 2, rich()), good = Simulation.create(asset, 2, rich());
    for (const sv of ['emergency', 'outpatient'] as const) { bad.state.departments[sv].nurses = 0; bad.state.departments[sv].physicians = 0; }
    good.applyAction({ type: 'hire', service: 'emergency', role: 'physician', count: 6 }); good.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 9 });
    bad.runToYearEnd(); good.runToYearEnd();
    expect(bad.state.reputation).toBeLessThan(50); expect(good.state.reputation).toBeGreaterThan(bad.state.reputation + 10);
    bad.runToYearEnd(); good.runToYearEnd();
    expect(bad.state.snapshots[1].arrivals.emergency).toBeLessThan(good.state.snapshots[1].arrivals.emergency);
  });
  it('replaying a game with decisions reproduces it exactly', () => {
    const cfg = rich(), a = Simulation.create(asset, 21, cfg);
    for (let y = 0; y < 4; y++) { const pc = a.state.pendingCard!; const card = getCard(pc.cardId)!; a.applyAction({ type: 'decide', cardId: card.id, optionId: card.options[card.options.length - 1].id }); a.runToYearEnd(); }
    const b = replay(asset, 21, a.state.actionLog, a.state.snapshots.length, cfg);
    expect(JSON.stringify(b.state.snapshots)).toBe(JSON.stringify(a.state.snapshots));
    expect(b.state.reputation).toBe(a.state.reputation); expect(b.state.decisionLog).toEqual(a.state.decisionLog);
  });
  it('decisions change the outcome: a thoughtful run beats doing nothing and a run that turns patients away', () => {
    const cfg = { ...Simulation.create(asset, 1).a, startingCashCents: 300000000 };
    const play = (strategy: 'nothing' | 'thoughtful' | 'greedy') => {
      const s = Simulation.create(asset, 3, cfg);
      if (strategy !== 'nothing') coachTips(s).find((t) => t.id === 'ward-closed')?.apply!.actions.forEach((a) => s.applyAction(a));
      if (strategy === 'greedy') s.applyAction({ type: 'setPolicy', medicaidAccess: 'limited' });
      const pick = (id: string) => (strategy === 'thoughtful' ? ({ 'medicaid-cut': 'lobby', 'nurse-contract': 'raise', 'free-clinic': 'fund', 'charity-policy': 'adopt', 'equity-press': 'invest', 'er-crisis': 'protocol', imaging: 'buy' } as Record<string, string>)[id] : undefined);
      while (!s.state.finished && !s.state.bankrupt) { const pc = s.state.pendingCard; const opt = pc && pick(pc.cardId); if (pc && opt) s.applyAction({ type: 'decide', cardId: pc.cardId, optionId: opt }); s.advance(8760, { stopAtYearEnd: true }); }
      return scorecard(s.state.snapshots, s.a, { bankrupt: s.state.bankrupt, finished: s.state.finished, dataIq: { asked: 0, correct: 0 } }).total;
    };
    const [nothing, thoughtful, greedy] = [play('nothing'), play('thoughtful'), play('greedy')];
    expect(thoughtful).toBeGreaterThan(nothing); expect(thoughtful).toBeGreaterThan(greedy);
  });
});

describe('economic-burden analysis (challenge question)', () => {
  const b = asset.insights!.burden!;
  it('shows the regressive pattern with design-based intervals: poor families over the 10% line far more often yet spending fewer dollars', () => {
    const poor = b.byPoverty['Poor (<100% FPL)'], rich = b.byPoverty['High income (400%+)'];
    expect(poor.highBurden10.est).toBeGreaterThan(3 * rich.highBurden10.est);
    expect(poor.meanFamilyOopUSD.est).toBeLessThan(rich.meanFamilyOopUSD.est);
    for (const r of Object.values(b.byPoverty)) { expect(r.highBurden10.se).toBeGreaterThan(0); expect(r.highBurden10.est).toBeGreaterThanOrEqual(r.highBurden20.est); expect(r.n).toBeGreaterThan(100); }
    expect(b.overall.highBurden10.est).toBeGreaterThan(0.03); expect(b.overall.highBurden10.est).toBeLessThan(0.15);
  });
  it('the quiz can ask about it and gets the answer right', () => {
    const qs = Array.from({ length: 40 }, (_, i) => buildQuestions(asset, 2024 + (i % 21), 2)).flat();
    const q = qs.find((x) => x.id === 'burden-poverty'); expect(q).toBeDefined();
    expect(q!.options[q!.answerIndex]).toBe('Poor (<100% FPL)'); expect(q!.explain).toContain('95% CI');
  });
  it('the charity-care decision cites the burden gap from MEPS', () => {
    expect(getCard('charity-policy')!.fact!(asset, {})).toContain('spend over 10% of income');
  });
});
