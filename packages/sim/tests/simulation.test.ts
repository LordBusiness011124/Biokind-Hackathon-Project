import { describe, expect, it } from 'vitest';
import { END_YEAR, Simulation, scorecard, replay, summarize, buildQuestions, coachTips, makeDemoAsset, serialize, validateAsset, type Action } from '../src';
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
  it('arrivals are identical regardless of player decisions (common random numbers)', () => {
    const a = Simulation.create(asset, 7), b = Simulation.create(asset, 7);
    b.applyAction({ type: 'hire', service: 'emergency', role: 'nurse', count: 6 });
    b.applyAction({ type: 'setProcessLevel', level: 2 });
    a.runToYearEnd(); b.runToYearEnd();
    expect(a.state.snapshots[0].arrivals).toEqual(b.state.snapshots[0].arrivals);
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
    expect(sc.objectives.length).toBe(6); expect(sc.total).toBeGreaterThanOrEqual(0); expect(sc.total).toBeLessThanOrEqual(100); expect('ABCDF').toContain(sc.grade);
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
