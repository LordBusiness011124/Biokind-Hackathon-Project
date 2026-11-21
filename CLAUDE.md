# Agent notes
- Data project first: never label demo/assumed numbers as MEPS. Provenance kinds: MEPS_OBSERVED / MEPS_CALIBRATED / MODEL_ASSUMPTION / SIMULATED / DEMO_SYNTHETIC.
- Sim logic lives in `packages/sim` and must stay deterministic (no Math.random, integer cents). UI/Phaser only read sim state via `apps/web/src/controller.ts`.
- Keep raw MEPS files out of git (`data/raw`). Run `npm test` and `npm run build` before committing.
