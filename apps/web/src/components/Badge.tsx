import type { ProvenanceKind } from '@hospital/sim';
const TITLES: Record<ProvenanceKind, string> = {
  MEPS_OBSERVED: 'Weighted survey statistic from MEPS', MEPS_CALIBRATED: 'Model calibrated to the MEPS distribution',
  MODEL_ASSUMPTION: 'Game/scenario assumption, not a survey finding', SIMULATED: 'Outcome produced by the simulation after your decisions',
  DEMO_SYNTHETIC: 'Placeholder data. NOT survey-backed',
};
export function Badge({ kind }: { kind: ProvenanceKind }) { return <span className={`badge b-${kind}`} title={TITLES[kind]}>{kind.replace('_', ' ')}</span>; }
