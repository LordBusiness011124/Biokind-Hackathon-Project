import type { ModelProvenance, PayerGroup, ProvenanceKind, ServiceType } from './types';

export interface Est { est: number; se: number }
export interface GroupInsight { n: number; weightedShare: number; sparse: boolean; emergency: Est; outpatient: Est; inpatient: Est; totalExpenditureUSD: Est; anyErVisit: Est }
export interface PaymentDist { mean: number; tailMean?: number; zeroShare?: number; quantileGrid: number[]; quantiles: number[]; }
export interface EventDist {
  nEvents: number; weightedEvents: number; source?: string; nights?: PaymentDist;
  facilityPaymentCents: PaymentDist; physicianPaymentCents: PaymentDist; facilityOutOfPocketCents: PaymentDist;
}
export interface AssetCell {
  ageBand: string; payer: PayerGroup; incomeBand: string; n: number; weightedPop: number; share: number;
  ratesPerPersonYear: Record<ServiceType, number>; rateSource: string; sparse: boolean;
}
export interface ModelAsset {
  modelVersion: string; provenanceKind: ProvenanceKind; calibrationYear: number;
  inputs: Record<string, { dtaSha256: string; sourceUrl: string }>;
  counts: { personsPositiveWeight: number; weightedPopulation: number };
  definitions: Record<string, unknown>;
  marginals: { payerShare: Record<string, number>; ageShare: Record<string, number>; overallRatesPerPersonYear: Record<ServiceType, number> };
  designBased?: { method: string; payerShare: Record<string, { est: number; se: number }>; ageShare: Record<string, { est: number; se: number }>; ratesPerPersonYear: Record<string, { est: number; se: number }> };
  insights?: {
    ratesAndSpendingByGroup: Record<'ageBand' | 'payer' | 'incomeBand', Record<string, GroupInsight>>;
    spendingConcentration: Record<string, number>; zeroExpenditureShare: number; meanTotalExpenditureUSD: number; medianTotalExpenditureUSD: number; note: string;
  };
  cells: AssetCell[];
  payments: Record<ServiceType, { pooled: EventDist; byPayer: Record<string, EventDist> }>;
  reconciliation: Record<string, { ratio: number | null }>;
  buildLog: string[];
}

export function assetProvenance(a: ModelAsset): ModelProvenance[] {
  const demo = a.provenanceKind === 'DEMO_SYNTHETIC';
  return [{
    kind: a.provenanceKind, sourceId: demo ? 'DEMO' : 'MEPS HC-256 + HC-254D/E/F',
    sourceUrl: 'https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-256',
    method: demo ? 'Hard-coded placeholder numbers. NOT survey data.' :
      'Survey-weighted (PERWT24F) cell rates per person-year and event-level facility payment quantiles by payer group.',
    calibrationYear: a.calibrationYear,
    assumptions: ['MEPS covers US civilian noninstitutionalized population, not any hospital', 'MEPS payments are not hospital revenue or cost'],
  }];
}

/** Clearly-labelled placeholder so the game runs without MEPS files. Never describe as survey-backed. */
export function makeDemoAsset(): ModelAsset {
  const grid = Array.from({ length: 21 }, (_, i) => i / 20);
  const pd = (m: number): PaymentDist => ({ mean: m, zeroShare: 0, quantileGrid: grid, quantiles: grid.map((q) => Math.round(m * (0.2 + 1.6 * q * q))) });
  const ed = (m: number): EventDist => ({ nights: { mean: 4, quantileGrid: grid, quantiles: grid.map((q) => 1 + Math.round(6 * q * q)) }, nEvents: 0, weightedEvents: 0, source: 'demo', facilityPaymentCents: pd(m), physicianPaymentCents: pd(m / 5), facilityOutOfPocketCents: pd(m / 10) });
  const payments = {} as ModelAsset['payments'];
  (['emergency', 'outpatient', 'inpatient'] as ServiceType[]).forEach((s) => {
    const m = s === 'emergency' ? 100000 : s === 'outpatient' ? 60000 : 1500000;
    payments[s] = { pooled: ed(m), byPayer: Object.fromEntries(['private', 'medicare', 'medicaid', 'uninsured', 'other'].map((p) => [p, ed(m)])) };
  });
  const cells: AssetCell[] = [];
  const ages: [string, number][] = [['0-17', 0.22], ['18-44', 0.36], ['45-64', 0.24], ['65+', 0.18]];
  ages.forEach(([a, sh]) => cells.push({ ageBand: a, payer: a === '65+' ? 'medicare' : 'private', incomeBand: '200-399%FPL', n: 0, weightedPop: 0, share: sh,
    ratesPerPersonYear: { emergency: 0.2, outpatient: 1, inpatient: 0.08 }, rateSource: 'demo', sparse: false } as AssetCell));
  return { modelVersion: 'demo-v0', provenanceKind: 'DEMO_SYNTHETIC', calibrationYear: 0, inputs: {}, counts: { personsPositiveWeight: 0, weightedPopulation: 0 },
    definitions: {}, marginals: { payerShare: {}, ageShare: {}, overallRatesPerPersonYear: { emergency: 0.2, outpatient: 1, inpatient: 0.08 } },
    cells, payments, reconciliation: {}, buildLog: ['DEMO SYNTHETIC PLACEHOLDER DATA'] };
}

export function validateAsset(a: unknown): asserts a is ModelAsset {
  const m = a as ModelAsset;
  if (!m || !Array.isArray(m.cells) || m.cells.length === 0) throw new Error('Model asset invalid: no cells');
  if (!m.payments?.emergency?.pooled || !m.payments?.outpatient?.pooled) throw new Error('Model asset invalid: missing payment distributions');
  const tot = m.cells.reduce((s, c) => s + c.share, 0);
  if (!(Math.abs(tot - 1) < 1e-6)) throw new Error(`Model asset invalid: cell shares sum to ${tot}`);
}
