/** Administrator scorecard: six objectives scored 0-100, weighted into a letter grade. Weights/thresholds are MODEL_ASSUMPTIONs (game design). */
import type { Assumptions } from './assumptions';
import type { AnnualSnapshot } from './types';

export interface Objective { id: 'finance' | 'access' | 'safety' | 'equity' | 'affordability' | 'dataIq'; label: string; score: number; detail: string; target: string }
export interface Scorecard { objectives: Objective[]; total: number; grade: string; years: number; survived: boolean }
const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));
export const gradeOf = (t: number) => (t >= 90 ? 'A' : t >= 80 ? 'B' : t >= 70 ? 'C' : t >= 60 ? 'D' : 'F');

export function scorecard(snaps: AnnualSnapshot[], a: Assumptions, ctx: { bankrupt: boolean; finished: boolean; dataIq: { asked: number; correct: number } }): Scorecard {
  const sum = (f: (s: AnnualSnapshot) => number) => snaps.reduce((t, s) => t + f(s), 0);
  const arrivals = sum((s) => s.arrivals.emergency + s.arrivals.outpatient + s.arrivals.inpatient), treated = sum((s) => s.treated.emergency + s.treated.outpatient + s.treated.inpatient);
  const diverted = sum((s) => s.unmet.emergency + s.unmet.inpatient), safetyArr = sum((s) => s.arrivals.emergency + s.arrivals.inpatient);
  // finance: end cash relative to starting cash; bankruptcy = 0
  const startCash = snaps[0]?.cashStartCents ?? a.startingCashCents, endCash = snaps.at(-1)?.cashCents ?? startCash;
  const finance = ctx.bankrupt ? 0 : endCash >= 2 * startCash ? 100 : endCash >= startCash ? 70 + 30 * ((endCash - startCash) / Math.max(1, startCash)) : endCash > 0 ? 40 * (endCash / startCash) + 20 : 10;
  const accessShare = arrivals ? treated / arrivals : 1;
  const access = clamp(((accessShare - 0.8) / 0.19) * 100);
  const divRate = safetyArr ? diverted / safetyArr : 0;                        // fraction of ER/ward arrivals transferred away
  const safety = clamp(100 - (divRate / 0.10) * 100);
  // equity: spread of average wait across insurance groups with >=30 arrivals/yr (pooled over the run)
  const g: Record<string, { w: number; t: number; arr: number }> = {};
  snaps.forEach((s) => Object.entries(s.byPayer).forEach(([k, v]) => { (g[k] ??= { w: 0, t: 0, arr: 0 }); g[k].w += v.waitTicksSum; g[k].t += v.treated; g[k].arr += v.arrivals; }));
  const waits = Object.values(g).filter((x) => x.arr >= 30 * Math.max(1, snaps.length) && x.t > 0).map((x) => x.w / x.t);
  const spread = waits.length > 1 ? Math.max(...waits) - Math.min(...waits) : 0;
  const equity = clamp(100 - (spread / 4) * 100);
  // affordability: share of low-income patient out-of-pocket cost relieved by the assistance fund (40 baseline, 100 at 50% relieved)
  const low = (s: AnnualSnapshot) => s.byIncome['<200%FPL']; const oop = sum((s) => low(s)?.oopCents ?? 0), rel = sum((s) => low(s)?.subsidizedOopCents ?? 0);
  const relieved = oop + rel > 0 ? rel / (oop + rel) : 0; const afford = clamp(40 + 60 * Math.min(1, relieved / 0.5));
  const dataIq = ctx.dataIq.asked ? (ctx.dataIq.correct / ctx.dataIq.asked) * 100 : 50;
  const w = a.scoring.weights;
  const objectives: Objective[] = [
    { id: 'finance', label: 'Financial viability', score: finance, target: 'Stay solvent; end with more cash than you started', detail: ctx.bankrupt ? 'Went bankrupt' : `End cash ${(endCash / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` },
    { id: 'access', label: 'Access', score: access, target: 'Treat at least 99% of arrivals', detail: `${(accessShare * 100).toFixed(1)}% treated` },
    { id: 'safety', label: 'Emergency safety', score: safety, target: 'Divert <1% of ER and ward patients (0 = perfect, 10% = zero score)', detail: `${(divRate * 100).toFixed(1)}% transferred away` },
    { id: 'equity', label: 'Equity', score: equity, target: 'Keep average waits similar across insurance groups', detail: waits.length > 1 ? `${spread.toFixed(1)} h gap between slowest and fastest group` : 'Not enough data yet' },
    { id: 'affordability', label: 'Affordability', score: afford, target: 'Relieve out-of-pocket costs for low-income patients', detail: `${(relieved * 100).toFixed(0)}% of low-income out-of-pocket relieved` },
    { id: 'dataIq', label: 'Data IQ', score: dataIq, target: 'Answer MEPS briefing questions correctly', detail: ctx.dataIq.asked ? `${ctx.dataIq.correct}/${ctx.dataIq.asked} correct` : 'No questions answered' },
  ];
  const total = objectives.reduce((t, o) => t + o.score * w[o.id], 0) / Object.values(w).reduce((x, y) => x + y, 0);
  return { objectives, total, grade: gradeOf(total), years: snaps.length, survived: !ctx.bankrupt };
}
