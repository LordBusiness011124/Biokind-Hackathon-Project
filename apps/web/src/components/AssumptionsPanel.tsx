import { useRef } from 'react';
import { RAW_ASSUMPTIONS } from '@hospital/sim';
import type { Controller } from '../controller';
import { Badge } from './Badge';

export function AssumptionsPanel({ ctl }: { ctl: Controller }) {
  const file = useRef<HTMLInputElement>(null);
  const a = ctl.asset;
  const download = () => {
    const url = URL.createObjectURL(new Blob([ctl.exportJson()], { type: 'application/json' }));
    const el = document.createElement('a'); el.href = url; el.download = `hospital-tycoon-${ctl.sim.state.year}.json`; el.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="panel-body">
      <section className="card">
        <h3>About this data</h3>
        <p className="note">Hospital Tycoon: 2044 is an educational scenario game, <b>not</b> a forecast, clinical tool or validated hospital cost model. Demand is calibrated to the Medical Expenditure Panel Survey 2024 (AHRQ): HC-256 full-year file and event files HC-254D/E/F. MEPS describes the US civilian noninstitutionalized population, and its payments are not hospital revenue, charges or cost. All people in the game are synthetic composites; no respondent records are shipped.</p>
        <div className="kv"><span>Model version</span><b>{a.modelVersion}</b></div>
        <div className="kv"><span>Provenance</span><b><Badge kind={a.provenanceKind} /></b></div>
        <div className="kv"><span>Seed · scenario</span><b>{ctl.sim.state.config.seed} · {ctl.sim.state.config.scenarioId}</b></div>
        {Object.entries(a.inputs).map(([k, v]) => <div className="kv" key={k}><span>{k} sha256</span><code>{v.dtaSha256.slice(0, 16)}…</code></div>)}
        <p className="note">Source: <a href="https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-256" target="_blank" rel="noreferrer">AHRQ MEPS HC-256</a>. Not endorsed by AHRQ.</p>
      </section>
      <section className="card">
        <h3>Save / load</h3>
        <div className="row wrap">
          <button onClick={() => { ctl.save(); ctl.say('Saved to this browser.'); }}>Save</button>
          <button onClick={() => ctl.load()} disabled={!ctl.hasSave()}>Load</button>
          <button onClick={download}>Export JSON</button>
          <button onClick={() => file.current?.click()}>Import JSON</button>
          <button onClick={() => { if (confirm('Start over from 2024?')) ctl.restart(); }}>New game</button>
        </div>
        <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) ctl.load(await f.text()); e.target.value = ''; }} />
      </section>
      <section className="card">
        <h3>Assumptions <Badge kind="MODEL_ASSUMPTION" /></h3>
        <p className="note">Everything below is a game/scenario parameter, not a survey finding (edit <code>packages/model-assets/default-assumptions.json</code>). Money is in integer cents.</p>
        <pre className="json">{JSON.stringify(RAW_ASSUMPTIONS, null, 1)}</pre>
      </section>
    </div>
  );
}
