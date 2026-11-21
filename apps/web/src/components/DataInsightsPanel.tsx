import type { Controller } from '../controller';
import { PAYERS, PLAYABLE } from '@hospital/sim';
import { usd, pct, num } from '../format';
import { Badge } from './Badge';
import { MepsExplorer, MethodsPrimer, SpendingLesson } from './MepsExplorer';

function Bars({ data }: { data: Record<string, number> }) {
  return <div className="bars">{Object.entries(data).map(([k, v]) => (<div className="bar" key={k}><span>{k}</span><i style={{ width: `${Math.min(100, v * 100)}%` }} className={`pc-${k}`} /><b>{pct(v, 1)}</b></div>))}</div>;
}

export function DataInsightsPanel({ ctl }: { ctl: Controller }) {
  const a = ctl.asset, sim = ctl.sim, exp = sim.expectedAnnualArrivals(), v = ctl.selected;
  return (
    <div className="panel-body">
      {ctl.isDemo && <div className="banner demo">DEMO MODE: SYNTHETIC PLACEHOLDER DATA. MEPS CALIBRATION NOT YET LOADED.{ctl.assetError ? ` (${ctl.assetError})` : ''}</div>}
      <MethodsPrimer />
      <MepsExplorer ctl={ctl} />
      <SpendingLesson ctl={ctl} />
      <section className="card">
        <h3>Why these patients?</h3>
        <p className="note">The community is a synthetic catchment of <b>{num(sim.population())}</b> people <Badge kind="MODEL_ASSUMPTION" />. Who they are and how often they use care comes from MEPS 2024 person weights (<code>PERWT24F</code>), {a.counts.personsPositiveWeight.toLocaleString()} respondents standing for {(a.counts.weightedPopulation / 1e6).toFixed(0)}M US civilians. Their care is not about any one hospital.</p>
        <h4>Insurance mix, weighted <Badge kind={ctl.isDemo ? 'DEMO_SYNTHETIC' : 'MEPS_OBSERVED'} /></h4>
        <Bars data={a.marginals.payerShare} />
        {a.designBased && <p className="note">95% CI (design-based, strata/PSU): {PAYERS.map((k) => `${k} ±${(196 * a.designBased!.payerShare[k].se).toFixed(1)}pp`).join(' · ')}</p>}
        <h4>Who arrives at your ER this year <Badge kind={ctl.isDemo ? 'DEMO_SYNTHETIC' : 'MEPS_CALIBRATED'} /></h4>
        <Bars data={sim.payerMix('emergency')} />
        <h4>Events per person-year <Badge kind={ctl.isDemo ? 'DEMO_SYNTHETIC' : 'MEPS_OBSERVED'} /></h4>
        {(['emergency', 'outpatient', 'inpatient'] as const).map((k) => { const d = a.designBased?.ratesPerPersonYear[k]; return (
          <div className="kv" key={k}><span>{k === 'inpatient' ? 'Inpatient stays' : k === 'emergency' ? 'ER visits' : 'Outpatient visits'}</span><b>{a.marginals.overallRatesPerPersonYear[k].toFixed(3)}{d ? <small> ±{(1.96 * d.se).toFixed(3)}</small> : null}</b></div>); })}
        <h4>Expected arrivals at your hospital this year <Badge kind="SIMULATED" /></h4>
        {PLAYABLE.map((s) => <div className="kv" key={s}><span>{s}: catchment × rate × hospital share ({pct(sim.a.hospitalShare[s])})</span><b>{num(exp[s])}</b></div>)}
        <p className="note">Hospital share is a <Badge kind="MODEL_ASSUMPTION" />. Each arrival becomes one visible patient (queues show at most 18 per department; extras are counted, not drawn).</p>
      </section>
      <section className="card">
        <h3>What payers paid (facility, per event)</h3>
        <table className="tbl"><thead><tr><th>Payer</th><th>ER mean</th><th>Clinic mean</th><th>n (ER/clinic)</th></tr></thead><tbody>
          {PAYERS.map((p) => { const e = a.payments.emergency.byPayer[p], o = a.payments.outpatient.byPayer[p]; return (
            <tr key={p}><td>{p}</td><td>{usd(e.facilityPaymentCents.mean)}</td><td>{usd(o.facilityPaymentCents.mean)}</td><td>{e.nEvents}/{o.nEvents}{(e.source ?? '').includes('low') || e.source === 'pooled_fallback' ? ' ⚠' : ''}</td></tr>); })}
        </tbody></table>
        <p className="note"><Badge kind={ctl.isDemo ? 'DEMO_SYNTHETIC' : 'MEPS_CALIBRATED'} /> From event files HC-254E/F facility payments, weighted. ⚠ = small sample. MEPS payments are what payers paid, <b>not</b> hospital revenue or cost.</p>
      </section>
      <section className="card">
        <h3>Selected patient</h3>
        {v ? (<>
          <div className="kv"><span>Visit</span><b>{v.id} · {v.service}</b></div>
          <div className="kv"><span>Synthetic person</span><b>age {v.patient.age} · {v.patient.payer} · {v.patient.incomeBand}</b></div>
          <div className="kv"><span>Severity (model)</span><b>{v.severityBand}/5</b></div>
          <div className="kv"><span>Modelled facility payment</span><b>{usd(v.expectedFacilityPaymentCents)} <Badge kind={v.source} /></b></div>
          <div className="kv"><span>…of which patient out-of-pocket</span><b>{usd(v.expectedOutOfPocketCents)}</b></div>
          <p className="note">Composite patient sampled from weighted cells. Not a real respondent.</p>
        </>) : <p className="note">Click any patient on the map.</p>}
      </section>
    </div>
  );
}
