export type ProvenanceKind = 'MEPS_OBSERVED' | 'MEPS_CALIBRATED' | 'MODEL_ASSUMPTION' | 'SIMULATED' | 'DEMO_SYNTHETIC';
export type ServiceType = 'emergency' | 'outpatient' | 'inpatient';
export type PlayableService = 'emergency' | 'outpatient' | 'inpatient';
export type PayerGroup = 'private' | 'medicare' | 'medicaid' | 'uninsured' | 'other' | 'unknown';
export const PLAYABLE: PlayableService[] = ['emergency', 'outpatient', 'inpatient'];
export const PAYERS: PayerGroup[] = ['private', 'medicare', 'medicaid', 'uninsured', 'other'];

export interface ModelProvenance {
  kind: ProvenanceKind; sourceId: string; sourceUrl?: string;
  method: string; calibrationYear?: number; assumptions?: string[];
}
export interface SyntheticPatient {
  id: string; age: number; payer: PayerGroup; incomeBand: string; riskBand: string; cohortId: string; isDemo: boolean;
}
export interface Visit {
  id: string; patientId: string; service: ServiceType;
  arrivalTick: number; treatmentTicks: number; severityBand: number;
  expectedFacilityPaymentCents: number; expectedOutOfPocketCents: number;
  source: ProvenanceKind;
  patient: SyntheticPatient;
}
export interface ActiveVisit { visit: Visit; startTick: number; endTick: number; }
export interface Department {
  id: string; service: PlayableService; roomSlots: number; nurses: number; physicians: number;
  queue: Visit[]; inService: ActiveVisit[]; capacityCredit: number;
}

export type LedgerCategory =
  | 'revenue.emergency' | 'revenue.outpatient' | 'revenue.inpatient'
  | 'cost.payroll' | 'cost.upkeep' | 'cost.variable' | 'cost.overhead' | 'cost.capital' | 'cost.subsidy' | 'cost.process' | 'cost.penalty';
export const LEDGER_CATEGORIES: LedgerCategory[] = [
  'revenue.emergency', 'revenue.outpatient', 'revenue.inpatient', 'cost.payroll', 'cost.upkeep', 'cost.variable',
  'cost.overhead', 'cost.capital', 'cost.subsidy', 'cost.process', 'cost.penalty'];
export type LedgerTotals = Record<LedgerCategory, number>;
export interface LedgerEntry { tick: number; category: LedgerCategory; cents: number; ref: string; }

export interface GroupStats { arrivals: number; treated: number; unmet: number; waitTicksSum: number; oopCents: number; subsidizedOopCents: number; }
export type ServiceMap<T> = Record<PlayableService, T>;

export interface AnnualSnapshot {
  year: number; seed: number; modelVersion: string; mode: ProvenanceKind;
  populationSize: number;
  arrivals: Record<ServiceType, number>;
  treated: Record<ServiceType, number>;
  unmet: Record<ServiceType, number>;
  avgWaitTicks: number; avgWaitTicksByService: ServiceMap<number>;
  revenueCents: number; expensesCents: number; netCents: number;
  cashStartCents: number; cashCents: number;
  ledger: LedgerTotals;
  staffCount: number; roomCount: number; physicians: number; nurses: number;
  unmetDemand: number;
  byPayer: Record<string, GroupStats>;
  byIncome: Record<string, GroupStats>;
  patientOopCents: number; subsidizedOopCents: number; avgOopPerVisitCents: number;
  decisions: string[];
  provenance: ModelProvenance[];
}

export type Action =
  | { type: 'hire'; service: PlayableService; role: 'nurse' | 'physician'; count: number }
  | { type: 'fire'; service: PlayableService; role: 'nurse' | 'physician'; count: number }
  | { type: 'addRoom'; service: PlayableService }
  | { type: 'setProcessLevel'; level: number }
  | { type: 'setSubsidy'; budgetCents: number };
export interface ActionResult { ok: boolean; error?: string; }

export type SimEvent =
  | { type: 'arrive'; tick: number; visit: Visit }
  | { type: 'start'; tick: number; visit: Visit; waitTicks: number }
  | { type: 'complete'; tick: number; visit: Visit; revenueCents: number }
  | { type: 'leave'; tick: number; visit: Visit; reason: 'diverted' | 'left_unseen' };
