import raw from '../../model-assets/default-assumptions.json';
import type { PlayableService } from './types';

export interface Assumptions {
  catchmentPopulation: { value: number };
  hospitalShare: Record<PlayableService, number>;
  startingCashCents: number; hoursPerYear: number;
  treatment: { emergencyHoursBySeverity: number[]; outpatientHoursBySeverity: number[]; severityWeights: number[] };
  staffing: Record<PlayableService, { fteToCoverPost: number; nursesPerPost: number; physiciansPerPost: number; openHours: [number, number] }>;
  costs: {
    physicianSalaryCents: number; nurseSalaryCents: number;
    roomUpkeepPerYearCents: Record<PlayableService, number>; roomBuildCostCents: Record<PlayableService, number>;
    variableCostPerEncounterCents: Record<PlayableService, number>; overheadPerYearCents: number;
    processImprovementCostCents: number[]; processImprovementUpkeepCents: number[]; processImprovementServiceTimeMultiplier: number[];
  };
  queue: { emergencyDiversionWaitTicks: number; outpatientLeaveWaitTicks: number };
  hiring: { maxPerDepartment: number };
  scenario: {
    populationGrowthPerYear: number; utilizationDriftPerYear: number; medicalPriceInflationPerYear: number;
    wageInflationPerYear: number; generalInflationPerYear: number;
    ageBandGrowthPerYear: Record<string, number>; uninsuredShareShiftPerYear: number;
  };
}
export const DEFAULT_ASSUMPTIONS = raw as unknown as Assumptions;
export const RAW_ASSUMPTIONS = raw as Record<string, unknown>;
