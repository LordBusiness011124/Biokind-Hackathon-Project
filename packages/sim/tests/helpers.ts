import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateAsset, type ModelAsset } from '../src';
export function loadAsset(): ModelAsset {
  const p = fileURLToPath(new URL('../../model-assets/derived/meps_baseline.json', import.meta.url));
  const a = JSON.parse(readFileSync(p, 'utf8')); validateAsset(a); return a;
}
