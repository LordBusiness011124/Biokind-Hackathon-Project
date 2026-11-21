import raw from '../../model-assets/default-assumptions.json';
import type { PlayableService } from './types';

export interface Assumptions {
  catchmentPopulation: { value: number };
  hospitalShare: Record<PlayableService, number>;
  startingCashCents: number; hoursPerYear: number;
  treatment: { inpatientMaxNights: number; emergencyHoursBySeverity: number[]; outpatientHoursBySeverity: number[]; severityWeights: number[] };
  staffing: Record<PlayableService, { fteToCoverPost: number; nursesPerPost: number; physiciansPerPost: number; bedsPerPost?: number; openHours: [number, number] }>;
  costs: {
    physicianSalaryCents: number; nurseSalaryCents: number;
    roomUpkeepPerYearCents: Record<PlayableService, number>; roomBuildCostCents: Record<PlayableService, number>;
    variableCostPerEncounterCents: Record<PlayableService, number>; overheadPerYearCents: number;
    processImprovementCostCents: number[]; processImprovementUpkeepCents: number[]; processImprovementServiceTimeMultiplier: number[];
  };
  queue: { emergencyDiversionWaitTicks: number; inpatientDiversionWaitTicks: number; divertedPenaltyCents: Record<'emergency' | 'inpatient', number>; outpatientLeaveWaitTicks: number };
  hiring: { maxPerDepartment: number };
  events: { list: EventDef[] };
  scoring: { weights: Record<'finance' | 'access' | 'safety' | 'equity' | 'affordability' | 'dataIq', number> };
  scenario: {
    populationGrowthPerYear: number; utilizationDriftPerYear: number; medicalPriceInflationPerYear: number;
    wageInflationPerYear: number; generalInflationPerYear: number;
    ageBandGrowthPerYear: Record<string, number>; uninsuredShareShiftPerYear: number;
  };
}
export interface EventDef { id: string; label: string; description: string; probability: number; arrivalMult: Record<PlayableService, number>; uninsuredMult: number; wageMult: number }
export const DEFAULT_ASSUMPTIONS = raw as unknown as Assumptions;
export const RAW_ASSUMPTIONS = raw as Record<string, unknown>;
