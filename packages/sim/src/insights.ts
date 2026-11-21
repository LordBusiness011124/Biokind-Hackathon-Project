/** MEPS-driven teaching layer: yearly briefing questions (answers always computed from the loaded asset) and a live Data Coach. */
import type { Est, ModelAsset } from './assets';
import type { Simulation } from './simulation';
import type { AnnualSnapshot, PlayableService, ProvenanceKind } from './types';

export interface Question {
  id: string; prompt: string; options: string[]; answerIndex: number;
  explain: string; stat: string; source: string; kind: ProvenanceKind;
}
const SVC_NAME: Record<string, string> = { emergency: 'emergency room (ER) visits', outpatient: 'outpatient visits', inpatient: 'hospital inpatient stays' };
const ci = (e: Est, f: (x: number) => string) => `${f(e.est)} (95% CI ${f(Math.max(0, e.est - 1.96 * e.se))} to ${f(e.est + 1.96 * e.se)})`;
const per100 = (x: number) => `${(x * 100).toFixed(1)}`;
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
const pctf = (x: number) => `${(x * 100).toFixed(1)}%`;
const DIM_LABEL = { ageBand: 'age group', payer: 'insurance group', incomeBand: 'income group (% of federal poverty level)' } as const;
const GROUP_LABEL: Record<string, string> = { private: 'Private insurance', medicare: 'Medicare', medicaid: 'Medicaid / other public', uninsured: 'Uninsured all year', other: 'Other public' };
const lab = (g: string) => GROUP_LABEL[g] ?? g;

/** bin an estimate into the option whose range contains it */
function binned(value: number, edges: number[], labels: string[]): number { let i = 0; while (i < edges.length && value >= edges[i]) i++; return i < labels.length ? i : labels.length - 1; }
const shuffleStable = <T,>(xs: T[], seed: number): T[] => { const a = [...xs]; let s = seed >>> 0 || 1; for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

type Tpl = (a: ModelAsset, v: number, ctx?: { last?: AnnualSnapshot }) => Question | null;

const groupMax = (dim: 'ageBand' | 'payer' | 'incomeBand', order: string[]): Tpl => (a, v) => {
  const ins = a.insights; if (!ins) return null;
  const svc = (['emergency', 'inpatient', 'outpatient'] as const)[v % 3];
  const groups = order.filter((g) => ins.ratesAndSpendingByGroup[dim][g] && !ins.ratesAndSpendingByGroup[dim][g].sparse);
  const rows = groups.map((g) => ({ g, e: ins.ratesAndSpendingByGroup[dim][g][svc] }));
  const best = rows.reduce((m, r) => (r.e.est > m.e.est ? r : m));
  return { id: `max-${dim}-${svc}`, prompt: `Which ${DIM_LABEL[dim]} had the most ${SVC_NAME[svc]} per person in 2024?`,
    options: groups.map(lab), answerIndex: groups.indexOf(best.g), kind: 'MEPS_OBSERVED',
    stat: rows.map((r) => `${lab(r.g)}: ${per100(r.e.est)} per 100 people`).join(' · '),
    explain: `${lab(best.g)} had ${ci(best.e, per100)} ${SVC_NAME[svc]} per 100 people per year. In your game this is why the patient mix at the ${svc === 'emergency' ? 'ER' : svc === 'inpatient' ? 'ward' : 'clinic'} differs from the community mix.`,
    source: `MEPS HC-256 ${svc === 'emergency' ? 'ERTOT24' : svc === 'inpatient' ? 'IPDIS24' : 'OPTOTV24'}, weight PERWT24F, design-based SE` };
};

const TEMPLATES: Tpl[] = [
  groupMax('ageBand', ['0-17', '18-44', '45-64', '65+']),
  groupMax('payer', ['private', 'medicare', 'medicaid', 'uninsured']),
  (a) => { const m = a.designBased?.payerShare.uninsured; if (!m) return null; const opts = ['Under 4%', '4% to 8%', '8% to 12%', 'Over 12%'];
    return { id: 'uninsured-share', prompt: 'What share of the US civilian noninstitutionalized population had no health insurance all year in 2024?', options: opts,
      answerIndex: binned(m.est, [0.04, 0.08, 0.12], opts), kind: 'MEPS_OBSERVED', stat: `Uninsured all year: ${ci(m, pctf)}`,
      explain: `About ${pctf(m.est)} (${ci(m, pctf)}). In the game these patients bring the lowest facility payments per visit relative to need, and they are the main target of the financial assistance fund.`, source: 'MEPS HC-256 INSCOV24==3, PERWT24F' }; },
  (a) => { const c = a.insights?.spendingConcentration; if (!c) return null; const opts = ['Under 30%', '30% to 50%', '50% to 70%', 'Over 70%'];
    return { id: 'top10-spend', prompt: 'What share of all health care spending is accounted for by the 10% of people who spend the most?', options: opts, answerIndex: binned(c.top10, [0.3, 0.5, 0.7], opts), kind: 'MEPS_OBSERVED',
      stat: `Top 1%: ${pctf(c.top1)} · top 5%: ${pctf(c.top5)} · top 10%: ${pctf(c.top10)} · top 50%: ${pctf(c.top50)}`,
      explain: `The top 10% account for ${pctf(c.top10)}. Spending is extremely skewed, which is why a handful of inpatient stays pay far more than thousands of visits, and why the game's inpatient ward matters so much for finances.`, source: 'MEPS HC-256 TOTEXP24, PERWT24F (point estimate)' }; },
  (a, v) => { const svc = (['emergency', 'outpatient', 'inpatient'] as const)[v % 3];
    const rows = ['private', 'medicare', 'medicaid', 'uninsured'].filter((p) => a.payments[svc].byPayer[p] && a.payments[svc].byPayer[p].source !== 'pooled_fallback' && !a.payments[svc].byPayer[p].source?.includes('low')).map((p) => ({ p, m: a.payments[svc].byPayer[p].facilityPaymentCents.mean }));
    if (rows.length < 3) return null; const best = rows.reduce((m, r) => (r.m > m.m ? r : m));
    return { id: `pay-${svc}`, prompt: `Which payer paid the most, on average, for the facility part of one ${svc === 'inpatient' ? 'inpatient stay' : svc === 'emergency' ? 'ER visit' : 'outpatient visit'}?`, options: rows.map((r) => lab(r.p)), answerIndex: rows.findIndex((r) => r.p === best.p), kind: 'MEPS_CALIBRATED',
      stat: rows.map((r) => `${lab(r.p)}: ${usd(r.m)}`).join(' · '), explain: `${lab(best.p)} paid the most (${usd(best.m)}). The game samples every visit's payment from these payer-specific distributions, so your payer mix directly sets your revenue. MEPS payments are what payers paid, not hospital revenue or cost.`, source: `MEPS event file ${svc === 'emergency' ? 'HC-254E ERFXP24X' : svc === 'inpatient' ? 'HC-254D IPFXP24X' : 'HC-254F OPFXP24X'}, weighted` }; },
  (a) => { const g = a.insights?.ratesAndSpendingByGroup; if (!g) return null; const tot = Object.values(g.payer).reduce((t, r) => t + r.weightedShare * r.anyErVisit.est, 0); const opts = ['Under 5%', '5% to 10%', '10% to 20%', 'Over 20%'];
    return { id: 'any-er', prompt: 'What share of people had at least one ER visit during 2024?', options: opts, answerIndex: binned(tot, [0.05, 0.1, 0.2], opts), kind: 'MEPS_OBSERVED', stat: `People with 1+ ER visit: ${pctf(tot)}`,
      explain: `About ${pctf(tot)}. Most people never use the ER in a year, but those who do can return, which is why arrivals in the game are lumpy and a few patients account for several visits.`, source: 'MEPS HC-256 ERTOT24>0, PERWT24F' }; },
  (a) => { const i = a.insights; if (!i) return null; const ratio = i.medianTotalExpenditureUSD / i.meanTotalExpenditureUSD; const opts = ['About the same as the mean', 'About half the mean', 'About one-fifth of the mean', 'Higher than the mean'];
    return { id: 'mean-median', prompt: `Average (mean) health spending per person in 2024 was ${`$${Math.round(i.meanTotalExpenditureUSD).toLocaleString('en-US')}`}. How does the median person's spending compare?`, options: opts,
      answerIndex: ratio > 1.05 ? 3 : ratio > 0.8 ? 0 : ratio > 0.35 ? 1 : 2, kind: 'MEPS_OBSERVED', stat: `Mean $${Math.round(i.meanTotalExpenditureUSD).toLocaleString('en-US')} · median $${Math.round(i.medianTotalExpenditureUSD).toLocaleString('en-US')} · ${pctf(i.zeroExpenditureShare)} spent nothing`,
      explain: `The median is $${Math.round(i.medianTotalExpenditureUSD).toLocaleString('en-US')}, about ${(ratio * 100).toFixed(0)}% of the mean, because a few very large spenders drag the mean up. That is why the game samples payments from the full distribution instead of using averages.`, source: 'MEPS HC-256 TOTEXP24, PERWT24F' }; },
  (a) => { const n = a.payments.inpatient.pooled.nights?.mean; if (!n) return null; const opts = ['Under 3 nights', '3 to under 5 nights', '5 to under 7 nights', '7+ nights'];
    return { id: 'stay-len', prompt: 'What is the average length of an inpatient hospital stay (nights)?', options: opts, answerIndex: binned(n, [3, 5, 7], opts), kind: 'MEPS_CALIBRATED', stat: `Mean ${n.toFixed(1)} nights (weighted)`,
      explain: `${n.toFixed(1)} nights on average (stays are capped at 30 nights in the game). Each admission occupies a ward bed for days, so a bed turns over about ${(365 / n).toFixed(0)} times a year at most.`, source: 'MEPS HC-254D NUMNIGHX, weighted' }; },
  (a) => { const r = a.designBased?.ratesPerPersonYear.outpatient; if (!r) return null; const opts = ['About 0.25 per person', 'About 0.5 per person', 'About 1 per person', 'About 2 per person']; const targets = [0.25, 0.5, 1, 2];
    const best = targets.reduce((bi, t, i) => (Math.abs(t - r.est) < Math.abs(targets[bi] - r.est) ? i : bi), 0);
    return { id: 'op-rate', prompt: 'How many outpatient (hospital clinic) visits did the average person have in 2024?', options: opts, answerIndex: best, kind: 'MEPS_OBSERVED', stat: `Outpatient visits per person-year: ${ci(r, (x) => x.toFixed(2))}`,
      explain: `${ci(r, (x) => x.toFixed(2))}. The estimate is the least precise of the three services because a few people have very many visits, a good reminder to read the confidence interval, not just the number.`, source: 'MEPS HC-256 OPTOTV24, PERWT24F, design-based SE' }; },
  (a, _v, ctx) => { const s = ctx?.last; if (!s) return null; const rows = Object.entries(s.byPayer).filter(([k, g]) => g.treated >= 30 && ['private', 'medicare', 'medicaid', 'uninsured'].includes(k)).map(([k, g]) => ({ k, w: g.waitTicksSum / g.treated }));
    if (rows.length < 3) return null; const worst = rows.reduce((m, r) => (r.w > m.w ? r : m));
    return { id: 'own-wait', prompt: `At your hospital in ${s.year}, which insurance group waited longest on average?`, options: rows.map((r) => lab(r.k)), answerIndex: rows.findIndex((r) => r.k === worst.k), kind: 'SIMULATED',
      stat: rows.map((r) => `${lab(r.k)}: ${r.w.toFixed(1)} h`).join(' · '), explain: `${lab(worst.k)} waited longest (${worst.w.toFixed(1)} h). Queues here are first-come-first-served, so differences come from WHEN each group arrives and who uses the long ER/ward visits (simulated outcome, not a MEPS finding). Check the equity table in your year-end report.`, source: 'Simulation output (your hospital)' }; },
];

/** Deterministic set of briefing questions for a year. Options are shuffled by a stable hash so the correct slot varies. */
export function buildQuestions(asset: ModelAsset, year: number, count = 2, last?: AnnualSnapshot): Question[] {
  if (asset.provenanceKind === 'DEMO_SYNTHETIC' || !asset.insights) return [];
  const out: Question[] = []; let slot = (year - 2024) * count;
  for (let guard = 0; out.length < count && guard < TEMPLATES.length * 3; guard++, slot++) {
    const q = TEMPLATES[slot % TEMPLATES.length](asset, Math.floor(slot / TEMPLATES.length), { last });
    if (!q || out.some((o) => o.id === q.id)) continue;
    const sh = shuffleStable(q.options.map((_, i) => i), year * 31 + out.length * 7 + q.id.length);
    out.push({ ...q, options: sh.map((i) => q.options[i]), answerIndex: sh.indexOf(q.answerIndex) });
  }
  return out;
}

// ---------------- Data Coach ----------------
export interface Tip { id: string; severity: 'warn' | 'info' | 'good'; title: string; meps: string; advice: string; tab?: string }
const meanHours = (sim: Simulation, svc: PlayableService) => { const t = sim.a.treatment, h = svc === 'emergency' ? t.emergencyHoursBySeverity : t.outpatientHoursBySeverity; return h.reduce((s, x, i) => s + x * t.severityWeights[i], 0); };
/** servers needed so queues stay short: offered load + 2 sqrt(load) (square-root staffing rule of thumb) */
const needServers = (load: number) => Math.ceil(load + 2 * Math.sqrt(load));

export function coachTips(sim: Simulation): Tip[] {
  const a = sim.asset, st = sim.state, tips: Tip[] = []; if (a.provenanceKind === 'DEMO_SYNTHETIC') return [{ id: 'demo', severity: 'warn', title: 'Demo mode', meps: 'No MEPS data loaded.', advice: 'Run `npm run data` to load the real MEPS 2024 asset; coaching needs it.' }];
  const exp = sim.expectedAnnualArrivals(), db = a.designBased, dep = st.departments, mixE = sim.payerMix('emergency');
  const erRate = db?.ratesPerPersonYear.emergency, ipRate = db?.ratesPerPersonYear.inpatient;
  const erPerDay = exp.emergency / 365, erLoad = (erPerDay * meanHours(sim, 'emergency')) / 24, erNeed = needServers(erLoad), erCap = sim.postsReal(dep.emergency);
  if (erCap < erNeed) tips.push({ id: 'er-cap', severity: 'warn', title: `ER capacity ${erCap.toFixed(1)} vs ~${erNeed} needed`, tab: 'manage',
    meps: `MEPS: ${erRate ? per100(erRate.est) : '?'} ER visits per 100 people per year × ${sim.population().toLocaleString()} residents × ${(sim.a.hospitalShare.emergency * 100).toFixed(0)}% share ≈ ${Math.round(exp.emergency).toLocaleString()} arrivals (${erPerDay.toFixed(1)}/day).`,
    advice: `Average treatment ${meanHours(sim, 'emergency').toFixed(1)} h keeps ~${erLoad.toFixed(1)} posts busy on average; peaks need about ${erNeed}. Each ER post costs ~4.5 physicians + 9 nurses of payroll, and diversions carry penalties, so weigh both.` });
  const ipPerYr = exp.inpatient, nights = a.payments.inpatient.pooled.nights?.mean ?? 5, occ = (ipPerYr * nights) / 365, bedsNeed = needServers(occ);
  const ipMean = Object.entries(a.payments.inpatient.byPayer).reduce((t, [p, d]) => t + (sim.payerMix('inpatient')[p] ?? 0) * d.facilityPaymentCents.mean, 0);
  if (dep.inpatient.roomSlots === 0) tips.push({ id: 'ward-closed', severity: 'warn', title: 'Your inpatient ward is closed', tab: 'manage',
    meps: `MEPS: ${ipRate ? per100(ipRate.est) : '?'} inpatient stays per 100 people per year (expect ~${Math.round(ipPerYr)} at your hospital); mean facility payment ${usd(ipMean)} per stay versus ${usd(a.payments.emergency.pooled.facilityPaymentCents.mean)} per ER visit.`,
    advice: `Stays average ${nights.toFixed(1)} nights, so ~${occ.toFixed(1)} beds are occupied on average; plan ~${bedsNeed} beds and one 6-bed staffing post per 6 beds. Stays are the biggest payment pool in the data (~${usd(ipMean * ipPerYr)}/yr), and every refused admission now costs a penalty.` });
  else if (sim.postsReal(dep.inpatient) < bedsNeed) tips.push({ id: 'ward-cap', severity: 'warn', title: `Ward capacity ${sim.postsReal(dep.inpatient).toFixed(1)} beds vs ~${bedsNeed} needed`, tab: 'manage',
    meps: `MEPS: ${nights.toFixed(1)} nights per stay × ~${Math.round(ipPerYr)} admissions ⇒ ~${occ.toFixed(1)} beds occupied on average.`, advice: 'Staffed beds are the minimum of built beds, physician cover and nurse cover. Check which one limits you.' });
  const opLoad = ((exp.outpatient / 365) * meanHours(sim, 'outpatient')) / 10, opCap = sim.postsReal(dep.outpatient), opNeed = needServers(opLoad);
  if (opCap > opNeed + 1) tips.push({ id: 'op-over', severity: 'info', title: `Clinic staffed for ${opCap.toFixed(1)}, load needs ~${opNeed}`, tab: 'manage',
    meps: `MEPS: ${db ? (db.ratesPerPersonYear.outpatient.est).toFixed(2) : '?'} outpatient visits per person-year ⇒ ~${Math.round(exp.outpatient)} visits at your clinic (${(exp.outpatient / 365).toFixed(1)}/day in 10 open hours).`, advice: 'You pay for idle capacity. Trimming one physician and one nurse is the cheapest saving in the game.' });
  const unins = mixE.uninsured ?? 0, mcd = mixE.medicaid ?? 0, e = a.payments.emergency.byPayer;
  tips.push({ id: 'payer-mix', severity: 'info', title: `${pctf(unins + mcd)} of ER arrivals are uninsured or Medicaid`,
    meps: `MEPS facility payment per ER visit: private ${usd(e.private.facilityPaymentCents.mean)}, Medicare ${usd(e.medicare.facilityPaymentCents.mean)}, Medicaid ${usd(e.medicaid.facilityPaymentCents.mean)}, uninsured ${usd(e.uninsured.facilityPaymentCents.mean)}${e.uninsured.source?.includes('low') ? ' (small sample)' : ''}.`,
    advice: 'Your ER revenue per visit is set by this mix, so the ER cannot pay for itself; it is subsidised by inpatient stays. Equity means treating everyone the same regardless.', tab: 'data' });
  if (st.subsidyBudgetCents === 0 && e.uninsured.facilityOutOfPocketCents.mean > 0) tips.push({ id: 'assist', severity: 'info', title: 'Patients pay out of pocket', tab: 'manage',
    meps: `MEPS: uninsured patients' own payments average ${usd(e.uninsured.facilityOutOfPocketCents.mean)} per ER visit (${pctf(e.uninsured.facilityOutOfPocketCents.mean / Math.max(1, e.uninsured.facilityPaymentCents.mean))} of what was paid) versus ${usd(e.private.facilityOutOfPocketCents.mean)} for private.`,
    advice: 'The financial assistance fund forgives this share for uninsured and <200% FPL patients. It lowers the affordability burden but costs real cash.' });
  const g = a.insights?.ratesAndSpendingByGroup.ageBand;
  if (g && st.year > 2024) { const r = g['65+'].emergency.est / g['18-44'].emergency.est; tips.push({ id: 'aging', severity: 'info', title: `Older residents are a growing share (${st.year})`, meps: `MEPS: 65+ have ${r.toFixed(1)}× the ER rate of 18-44 year-olds per person; the scenario grows the 65+ share ${(sim.a.scenario.ageBandGrowthPerYear['65+'] * 100).toFixed(1)}%/yr (assumption).`, advice: 'Expect demand per resident to rise and payer mix to shift toward Medicare (lower facility payments per visit than private).' }); }
  if (!tips.some((t) => t.severity === 'warn')) tips.unshift({ id: 'good', severity: 'good', title: 'Capacity matches the MEPS-implied demand', meps: `Expected ${Math.round(exp.emergency)} ER, ${Math.round(exp.outpatient)} clinic and ${Math.round(exp.inpatient)} inpatient arrivals this year.`, advice: 'Watch finances and equity next: open the year-end report after the year closes.' });
  const rank = { warn: 0, info: 1, good: 2 } as const;
  return tips.sort((x, y) => rank[x.severity] - rank[y.severity]).slice(0, 4);
}
