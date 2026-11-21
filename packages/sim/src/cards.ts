/** Board-meeting decision cards. Each year the player faces one dilemma; every option has a price, lasting effects and sometimes risk.
 *  Effects are illustrative scenario assumptions (MODEL_ASSUMPTION), grounded where possible by a MEPS fact shown beside the choice. */
import type { ModelAsset } from './assets';
import type { AnnualSnapshot, MedicaidAccess, Modifier, ModifierKind, PayerGroup, PlayableService } from './types';

export interface ModDef { kind: ModifierKind; service?: PlayableService | 'all'; payer?: PayerGroup; value: number; years: number; label: string }
export interface Outcome { text: string; cashCents?: number; trust?: number; modifiers?: ModDef[]; subsidyDeltaCents?: number; medicaidAccess?: MedicaidAccess }
export interface CardContext { last?: AnnualSnapshot }
export interface CardOption {
  id: string; label: string; detail: string; upfrontCents: number;
  outcome: Outcome | ((c: CardContext) => Outcome);
  risk?: { prob: number; failure: Outcome };
}
export interface DecisionCard {
  id: string; title: string; story: string; fact?: (a: ModelAsset, c: CardContext) => string | null;
  options: CardOption[]; defaultOptionId: string; minYear?: number; conditional?: boolean; eligible?: (c: CardContext) => boolean;
}

const k = (dollars: number) => Math.round(dollars * 100);
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const SVC: Record<string, string> = { emergency: 'ER', outpatient: 'Clinic', inpatient: 'Ward', all: 'All services' };
const PAYER: Record<string, string> = { private: 'Private-insurance', medicare: 'Medicare', medicaid: 'Medicaid', uninsured: 'Uninsured', other: 'Other public' };

export function waitSpread(s?: AnnualSnapshot): number {
  if (!s) return 0;
  const w = Object.values(s.byPayer).filter((g) => g.treated >= 30).map((g) => g.waitTicksSum / g.treated);
  return w.length > 1 ? Math.max(...w) - Math.min(...w) : 0;
}
export function divertRate(s?: AnnualSnapshot): number {
  if (!s) return 0; const arr = s.arrivals.emergency + s.arrivals.inpatient;
  return arr ? (s.unmet.emergency + s.unmet.inpatient) / arr : 0;
}

export const CARDS: DecisionCard[] = [
  {
    id: 'medicaid-cut', title: 'State budget: Medicaid rate cut', minYear: 2025, defaultOptionId: 'absorb',
    story: 'The state proposes cutting what it pays hospitals for Medicaid patients by 12% for the next four years.',
    fact: (a) => { const m = a.insights?.ratesAndSpendingByGroup.payer.medicaid, e = a.payments.emergency.byPayer;
      const pv = a.insights?.ratesAndSpendingByGroup.payer.private;
      return m && pv ? `MEPS: Medicaid is ${pct(m.weightedShare)} of people and they use the ER more (${(m.emergency.est * 100).toFixed(1)} visits per 100 people versus ${(pv.emergency.est * 100).toFixed(1)} for private insurance), yet an ER visit pays ${usd(e.medicaid.facilityPaymentCents.mean)} for Medicaid versus ${usd(e.private.facilityPaymentCents.mean)} for private.` : null; },
    options: [
      { id: 'absorb', label: 'Absorb the cut', detail: 'Keep treating everyone; Medicaid visits pay less.', upfrontCents: 0,
        outcome: { text: 'Medicaid payments fall 12% for four years.', modifiers: [{ kind: 'paymentMult', payer: 'medicaid', value: 0.88, years: 4, label: 'State Medicaid rate cut' }] } },
      { id: 'lobby', label: 'Lobby with the hospital association', detail: 'Costs money and may not work.', upfrontCents: k(90_000),
        outcome: { text: 'Lobbying softened the cut to 4%.', modifiers: [{ kind: 'paymentMult', payer: 'medicaid', value: 0.96, years: 4, label: 'Softened Medicaid cut' }] },
        risk: { prob: 0.5, failure: { text: 'Lobbying failed: the full 12% cut applies, and the spending drew criticism.', trust: -2, modifiers: [{ kind: 'paymentMult', payer: 'medicaid', value: 0.88, years: 4, label: 'State Medicaid rate cut' }] } } },
      { id: 'limit', label: 'Limit elective Medicaid and uninsured patients', detail: 'Protects revenue per visit; ER care continues by law.', upfrontCents: 0,
        outcome: { text: 'You limit non-emergency access for Medicaid and uninsured patients. Many are turned away, and the community notices.', trust: -4, medicaidAccess: 'limited',
          modifiers: [{ kind: 'paymentMult', payer: 'medicaid', value: 0.88, years: 4, label: 'State Medicaid rate cut' }] } },
    ],
  },
  {
    id: 'nurse-contract', title: 'Nurses’ union contract', defaultOptionId: 'hold',
    story: 'The nurses’ union is negotiating a new contract. Payroll is your biggest cost, but burnout is real.',
    options: [
      { id: 'raise', label: 'Agree to a 6% raise', detail: 'Wages rise for five years; staff are happier.', upfrontCents: 0,
        outcome: { text: 'Staff are satisfied. Wages rise 6% for five years.', trust: 2, modifiers: [{ kind: 'wageMult', value: 1.06, years: 5, label: 'Nurse contract (+6% wages)' }] } },
      { id: 'hold', label: 'Hold the line', detail: 'No raise, but there is a real chance of a walkout.', upfrontCents: 0,
        outcome: { text: 'Talks end quietly with no change.' },
        risk: { prob: 0.45, failure: { text: 'Nurses strike. Capacity drops 20% for the year and trust falls.', trust: -4, modifiers: [{ kind: 'capacityMult', value: 0.8, years: 1, label: 'Nurse strike' }] } } },
      { id: 'temps', label: 'Pay for agency temps as cover', detail: 'Expensive insurance against a strike.', upfrontCents: k(250_000),
        outcome: { text: 'Temps cover any walkout. Wages creep up 2% for two years.', modifiers: [{ kind: 'wageMult', value: 1.02, years: 2, label: 'Temp-agency wage pressure' }] } },
    ],
  },
  {
    id: 'imaging', title: 'Advanced imaging equipment', defaultOptionId: 'skip',
    story: 'A vendor offers advanced imaging for your clinic. Better equipment brings in higher-paying procedures, but costs money to buy and run.',
    fact: (a) => `MEPS: outpatient visits are the most common service (${a.designBased ? (a.designBased.ratesPerPersonYear.outpatient.est).toFixed(2) : '~1'} per person per year) and average ${usd(a.payments.outpatient.pooled.facilityPaymentCents.mean)} in facility payments.`,
    options: [
      { id: 'buy', label: 'Buy the equipment', detail: 'Big upfront cost; higher clinic payments for years.', upfrontCents: k(650_000),
        outcome: { text: 'Clinic payments rise 5% for 15 years; upkeep adds 5% to overhead.', modifiers: [{ kind: 'paymentMult', service: 'outpatient', value: 1.05, years: 15, label: 'Imaging: higher clinic payments' }, { kind: 'overheadMult', value: 1.05, years: 15, label: 'Imaging upkeep' }] } },
      { id: 'lease', label: 'Lease it', detail: 'Small upfront cost, ongoing fees, smaller gain.', upfrontCents: k(60_000),
        outcome: { text: 'Clinic payments rise 3% for six years; lease fees add 12% to overhead.', modifiers: [{ kind: 'paymentMult', service: 'outpatient', value: 1.03, years: 6, label: 'Imaging lease: clinic payments' }, { kind: 'overheadMult', value: 1.12, years: 6, label: 'Imaging lease fees' }] } },
      { id: 'skip', label: 'Skip it', detail: 'Keep things as they are.', upfrontCents: 0, outcome: { text: 'You pass on the equipment.' } },
    ],
  },
  {
    id: 'free-clinic', title: 'Community health partnership', defaultOptionId: 'decline',
    story: 'A neighbourhood coalition asks you to host free clinic days for people who avoid care because of cost.',
    fact: (a) => { const g = a.insights?.ratesAndSpendingByGroup.payer;
      return g ? `MEPS: uninsured people had ${(g.uninsured.emergency.est * 100).toFixed(1)} ER visits per 100 people per year versus ${(g.private.emergency.est * 100).toFixed(1)} for the privately insured, a gap consistent with cost barriers to care.` : null; },
    options: [
      { id: 'fund', label: 'Fund the free clinic days', detail: 'Costs money; brings in more patients and goodwill.', upfrontCents: k(120_000),
        outcome: { text: 'Clinic demand rises 10% for five years, trust grows, and overhead rises 5%.', trust: 5, modifiers: [{ kind: 'arrivalMult', service: 'outpatient', value: 1.1, years: 5, label: 'Free clinic days' }, { kind: 'overheadMult', value: 1.05, years: 5, label: 'Free clinic days: running costs' }] } },
      { id: 'decline', label: 'Decline', detail: 'Stay focused on the core business.', upfrontCents: 0, outcome: { text: 'You decline the partnership.' } },
    ],
  },
  {
    id: 'flu-vax', title: 'Vaccination drive', defaultOptionId: 'skip',
    story: 'Public health asks hospitals to run a vaccination drive before respiratory season.',
    options: [
      { id: 'fund', label: 'Run the drive', detail: 'Fewer preventable ER visits, which also means fewer ER payments.', upfrontCents: k(100_000),
        outcome: { text: 'ER demand falls 8% for three years and trust rises.', trust: 2, modifiers: [{ kind: 'arrivalMult', service: 'emergency', value: 0.92, years: 3, label: 'Vaccination drive' }] } },
      { id: 'skip', label: 'Skip it', detail: 'Save the money.', upfrontCents: 0, outcome: { text: 'No drive this year.' } },
    ],
  },
  {
    id: 'telehealth', title: 'Telehealth program', defaultOptionId: 'skip',
    story: 'Your clinic could offer video visits. Success depends on whether patients actually adopt them.',
    options: [
      { id: 'launch', label: 'Full launch', detail: 'Higher cost, bigger gain, real risk.', upfrontCents: k(220_000),
        outcome: { text: 'Telehealth takes off: clinic demand +8% and visits 8% faster for eight years.', modifiers: [{ kind: 'arrivalMult', service: 'outpatient', value: 1.08, years: 8, label: 'Telehealth demand' }, { kind: 'serviceTimeMult', service: 'outpatient', value: 0.92, years: 8, label: 'Telehealth speed' }] },
        risk: { prob: 0.25, failure: { text: 'Adoption is poor: only the faster visits materialise.', modifiers: [{ kind: 'serviceTimeMult', service: 'outpatient', value: 0.92, years: 8, label: 'Telehealth speed' }] } } },
      { id: 'pilot', label: 'Small pilot', detail: 'Cheap and safe, smaller gain.', upfrontCents: k(60_000), outcome: { text: 'The pilot lifts clinic demand 3% for four years.', modifiers: [{ kind: 'arrivalMult', service: 'outpatient', value: 1.03, years: 4, label: 'Telehealth pilot' }] } },
      { id: 'skip', label: 'Skip it', detail: 'Not now.', upfrontCents: 0, outcome: { text: 'You pass on telehealth.' } },
    ],
  },
  {
    id: 'audit', title: 'Regulator quality audit', minYear: 2026, defaultOptionId: 'cooperate',
    story: 'The state regulator audits quality and safety. How you did last year decides the result: transferring ER and ward patients away counts against you.',
    fact: (_a, c) => (c.last ? `Last year you transferred away ${pct(divertRate(c.last), 1)} of ER and ward arrivals; the audit passes below 3%.` : null),
    options: [
      { id: 'cooperate', label: 'Cooperate with the audit', detail: 'Pass and earn a bonus, or fail and pay a fine.', upfrontCents: 0,
        outcome: (c) => (divertRate(c.last) < 0.03 ? { text: 'You passed. A quality bonus arrives and trust rises.', cashCents: k(100_000), trust: 6 } : { text: 'You failed the audit: a fine, and a loss of trust.', cashCents: -k(150_000), trust: -6 }) },
      { id: 'consultant', label: 'Hire an audit consultant', detail: 'Costs more upfront but cushions a bad result.', upfrontCents: k(80_000),
        outcome: (c) => (divertRate(c.last) < 0.03 ? { text: 'You passed with flying colours. A bonus arrives and trust rises.', cashCents: k(100_000), trust: 6 } : { text: 'You failed, but the consultant limited the damage.', cashCents: -k(50_000), trust: -3 }) },
    ],
  },
  {
    id: 'ppo', title: 'Preferred-provider contract', defaultOptionId: 'decline',
    story: 'A large private insurer offers a preferred-provider contract with better rates in exchange for more paperwork.',
    fact: (a) => { const e = a.payments.emergency.byPayer, p = a.marginals.payerShare.private;
      return `MEPS: private insurance pays ${usd(e.private.facilityPaymentCents.mean)} per ER visit versus ${usd(e.medicare.facilityPaymentCents.mean)} for Medicare, and covers ${pct(p)} of people.`; },
    options: [
      { id: 'join', label: 'Join the network', detail: 'Better private payments, but contracts can end.', upfrontCents: 0,
        outcome: { text: 'Private payments rise 10% for five years; administration costs rise 4%.', modifiers: [{ kind: 'paymentMult', payer: 'private', value: 1.1, years: 5, label: 'Preferred-provider rates' }, { kind: 'overheadMult', value: 1.04, years: 5, label: 'Contract administration' }] },
        risk: { prob: 0.3, failure: { text: 'The insurer exits after one year, and you keep the paperwork.', modifiers: [{ kind: 'paymentMult', payer: 'private', value: 1.1, years: 1, label: 'Preferred-provider rates' }, { kind: 'overheadMult', value: 1.04, years: 5, label: 'Contract administration' }] } } },
      { id: 'decline', label: 'Decline', detail: 'Keep your independence.', upfrontCents: 0, outcome: { text: 'You decline the contract.' } },
    ],
  },
  {
    id: 'charity-policy', title: 'Charity-care policy', defaultOptionId: 'status-quo',
    story: 'The board debates how generously to help patients who cannot afford their share of the bill.',
    fact: (a) => { const e = a.payments.emergency.byPayer;
      const b = a.insights?.burden?.byPoverty, poor = b?.['Poor (<100% FPL)'], rich = b?.['High income (400%+)'];
      const burden = poor && rich ? ` Across all care, ${pct(poor.highBurden10.est, 1)} of people in poor families spend over 10% of income out of pocket versus ${pct(rich.highBurden10.est, 1)} in high-income families.` : '';
      return `MEPS: uninsured patients’ own payments average ${usd(e.uninsured.facilityOutOfPocketCents.mean)} per ER visit versus ${usd(e.private.facilityOutOfPocketCents.mean)} for the privately insured${e.uninsured.source?.includes('low') ? ' (small sample)' : ''}.${burden}`; },
    options: [
      { id: 'adopt', label: 'Adopt generous assistance', detail: 'Adds $250,000 a year to the assistance fund.', upfrontCents: 0, outcome: { text: 'The assistance fund grows by $250,000 a year. Patients and the community respond well.', trust: 3, subsidyDeltaCents: k(250_000) } },
      { id: 'status-quo', label: 'Keep things as they are', detail: 'No change.', upfrontCents: 0, outcome: { text: 'No change to assistance.' } },
      { id: 'tighten', label: 'Tighten collections', detail: 'Closes the assistance fund; hurts trust.', upfrontCents: 0, outcome: { text: 'Collections tighten and the assistance fund closes. Trust drops.', trust: -3, subsidyDeltaCents: -k(1_000_000_000) } },
    ],
  },
  {
    id: 'analytics', title: 'University analytics partnership', defaultOptionId: 'decline',
    story: 'A local university offers to analyse your patient flow with survey data like MEPS to find bottlenecks.',
    options: [
      { id: 'fund', label: 'Fund the partnership', detail: 'Modest cost; smoother operations.', upfrontCents: k(60_000), outcome: { text: 'Bottlenecks found: visits run 2% faster for five years.', trust: 2, modifiers: [{ kind: 'serviceTimeMult', value: 0.98, years: 5, label: 'Analytics-driven flow fixes' }] } },
      { id: 'decline', label: 'Decline', detail: 'Not a priority.', upfrontCents: 0, outcome: { text: 'You decline.' } },
    ],
  },
  {
    id: 'equity-press', title: 'Local news: unequal waits', conditional: true, minYear: 2025, defaultOptionId: 'ignore',
    eligible: (c) => waitSpread(c.last) > 1.5,
    story: 'A local reporter finds that some insurance groups wait far longer than others at your hospital.',
    fact: (_a, c) => { const g = Object.entries(c.last?.byPayer ?? {}).filter(([, v]) => v.treated >= 30).map(([p, v]) => ({ p, w: v.waitTicksSum / v.treated })).sort((x, y) => y.w - x.w);
      return g.length > 1 ? `Last year ${PAYER[g[0].p] ?? g[0].p} patients waited ${g[0].w.toFixed(1)} h on average versus ${g[g.length - 1].w.toFixed(1)} h for ${PAYER[g[g.length - 1].p] ?? g[g.length - 1].p} patients.` : null; },
    options: [
      { id: 'invest', label: 'Fund a patient-navigation program', detail: 'Helps everyone move through faster.', upfrontCents: k(100_000), outcome: { text: 'Navigation staff smooth the flow: visits 3% faster for three years and trust rises.', trust: 4, modifiers: [{ kind: 'serviceTimeMult', value: 0.97, years: 3, label: 'Patient navigation' }] } },
      { id: 'ignore', label: 'Ignore the story', detail: 'Hope it blows over.', upfrontCents: 0, outcome: { text: 'The story spreads and trust falls.', trust: -5 } },
    ],
  },
  {
    id: 'er-crisis', title: 'ER physicians warn of an unsafe department', conditional: true, minYear: 2025, defaultOptionId: 'ignore',
    eligible: (c) => divertRate(c.last) > 0.03,
    story: 'Emergency physicians warn that the department is overwhelmed and patients are being turned away.',
    fact: (_a, c) => (c.last ? `Last year you transferred away ${pct(divertRate(c.last), 1)} of ER and ward arrivals.` : null),
    options: [
      { id: 'protocol', label: 'Retention bonuses and an overflow protocol', detail: 'Costs money; ER capacity improves.', upfrontCents: k(150_000), outcome: { text: 'Overflow protocol works: ER capacity +15% for two years and trust rises.', trust: 2, modifiers: [{ kind: 'capacityMult', service: 'emergency', value: 1.15, years: 2, label: 'ER overflow protocol' }] } },
      { id: 'ignore', label: 'Ignore the warning', detail: 'Save the money.', upfrontCents: 0, outcome: { text: 'Two physicians resign: ER capacity −10% for a year and trust falls.', trust: -3, modifiers: [{ kind: 'capacityMult', service: 'emergency', value: 0.9, years: 1, label: 'ER physician resignations' }] } },
    ],
  },
];
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const getCard = (id: string): DecisionCard | undefined => BY_ID.get(id);

/** Deterministic uniform [0,1) from (seed, year, key). Independent of the simulation RNG and of player decisions. */
export function hash01(seed: number, year: number, key: string): number {
  let h = (Math.imul(seed + 1, 2654435761) ^ Math.imul(year, 40503)) | 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The year's dilemma. Cards that react to how you have been playing (conditional) are drawn first; others avoid repeats until exhausted. */
export function pickCard(seed: number, year: number, usedIds: string[], ctx: CardContext): DecisionCard {
  const pool = CARDS.filter((c) => (c.minYear ?? 2024) <= year && (c.eligible?.(ctx) ?? true));
  const fresh = pool.filter((c) => !usedIds.includes(c.id));
  const cond = fresh.filter((c) => c.conditional);
  if (cond.length && hash01(seed, year, 'conditional') < 0.8) return cond[Math.floor(hash01(seed, year, 'pick-conditional') * cond.length)];
  const general = pool.filter((c) => !c.conditional), freshGeneral = general.filter((c) => !usedIds.includes(c.id));
  const list = freshGeneral.length ? freshGeneral : general;
  return list[Math.floor(hash01(seed, year, 'pick') * list.length)];
}

// ---------- plain-language descriptions (used by the UI so the text can never drift from the numbers) ----------
export function describeModDef(m: Pick<ModDef, 'kind' | 'service' | 'payer' | 'value'> & { years?: number; untilYear?: number }): string {
  const svc = SVC[m.service ?? 'all'], who = m.payer ? PAYER[m.payer] : '', pc = Math.round((m.value - 1) * 100), sign = pc >= 0 ? '+' : '−', n = `${sign}${Math.abs(pc)}%`;
  const dur = m.years ? ` for ${m.years} yr${m.years > 1 ? 's' : ''}` : m.untilYear ? ` through ${m.untilYear}` : '';
  switch (m.kind) {
    case 'arrivalMult': return `${svc} demand ${n}${dur}`;
    case 'paymentMult': return `${who ? `${who} ` : ''}${m.service && m.service !== 'all' ? `${svc} ` : ''}payments ${n}${dur}`.replace(/\s+/g, ' ');
    case 'wageMult': return `Wages ${n}${dur}`;
    case 'overheadMult': return `Overhead ${n}${dur}`;
    case 'serviceTimeMult': return `${svc} visit time ${n}${dur}`;
    case 'capacityMult': return `${svc} capacity ${n}${dur}`;
  }
}
export function describeOutcome(o: Outcome): string[] {
  const out: string[] = [];
  if (o.cashCents) out.push(`${o.cashCents > 0 ? '+' : '−'}${usd(Math.abs(o.cashCents))} cash`);
  if (o.trust) out.push(`Community trust ${o.trust > 0 ? '+' : '−'}${Math.abs(o.trust)}`);
  for (const m of o.modifiers ?? []) out.push(describeModDef(m));
  if (o.subsidyDeltaCents) out.push(o.subsidyDeltaCents > 0 ? `Assistance fund +${usd(o.subsidyDeltaCents)}/yr` : 'Assistance fund closed');
  if (o.medicaidAccess === 'limited') out.push('Elective Medicaid and uninsured access limited');
  return out;
}
export function describeOption(o: CardOption): { cost: string | null; effects: string[]; risk: string | null } {
  const base = typeof o.outcome === 'function' ? null : o.outcome;
  return {
    cost: o.upfrontCents ? usd(o.upfrontCents) : null,
    effects: base ? describeOutcome(base) : ['Outcome depends on how well you did last year'],
    risk: o.risk ? `${Math.round(o.risk.prob * 100)}% chance of a setback: ${describeOutcome(o.risk.failure).join('; ') || o.risk.failure.text}` : null,
  };
}
export const modifierFromDef = (d: ModDef, year: number, id: string): Modifier => ({ id, label: d.label, kind: d.kind, service: d.service ?? 'all', payer: d.payer, value: d.value, untilYear: year + d.years - 1 });
