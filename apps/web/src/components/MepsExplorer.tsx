import { useState } from 'react';
import type { Controller } from '../controller';
import { pct, usd } from '../format';
import { Badge } from './Badge';

const DIMS = { ageBand: 'Age group', payer: 'Insurance', incomeBand: 'Income (% poverty level)' } as const;
const SVCS = { emergency: 'ER visits', outpatient: 'Outpatient visits', inpatient: 'Inpatient stays' } as const;
type Dim = keyof typeof DIMS; type Svc = keyof typeof SVCS;

export function MepsExplorer({ ctl }: { ctl: Controller }) {
  const [dim, setDim] = useState<Dim>('payer'); const [svc, setSvc] = useState<Svc>('emergency');
  const a = ctl.asset, ins = a.insights; if (!ins) return <section className="card"><h3>MEPS Explorer</h3><p className="note">Needs the real MEPS asset (run <code>npm run data</code>).</p></section>;
  const rows = Object.entries(ins.ratesAndSpendingByGroup[dim]);
  const max = Math.max(...rows.map(([, r]) => r[svc].est + 1.96 * r[svc].se));
  // share of arrivals each group generates (population share x use rate), baseline 2024
  const key = dim === 'ageBand' ? 'ageBand' : dim === 'payer' ? 'payer' : 'incomeBand';
  const tot = a.cells.reduce((t, c) => t + c.share * c.ratesPerPersonYear[svc], 0);
  const arr = (g: string) => a.cells.filter((c) => c[key] === g).reduce((t, c) => t + c.share * c.ratesPerPersonYear[svc], 0) / (tot || 1);
  return (
    <section className="card">
      <h3>MEPS Explorer <Badge kind="MEPS_OBSERVED" /></h3>
      <div className="row wrap">
        {(Object.keys(SVCS) as Svc[]).map((k) => <button key={k} className={svc === k ? 'on' : ''} onClick={() => setSvc(k)}>{SVCS[k]}</button>)}
      </div>
      <div className="row wrap">
        {(Object.keys(DIMS) as Dim[]).map((k) => <button key={k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>by {DIMS[k]}</button>)}
      </div>
      <p className="note">{SVCS[svc]} per 100 people per year, with 95% confidence interval (design-based). Long bar = more use per person.</p>
      {rows.map(([g, r]) => { const e = r[svc], lo = Math.max(0, e.est - 1.96 * e.se), hi = e.est + 1.96 * e.se; return (
        <div className="xrow" key={g}>
          <div className="xl">{g}{r.sparse ? ' ⚠' : ''}<small> n={r.n}</small></div>
          <div className="xbar"><i className={`pc-${g}`} style={{ width: `${(e.est / max) * 100}%` }} /><u style={{ left: `${(lo / max) * 100}%`, width: `${((hi - lo) / max) * 100}%` }} /></div>
          <div className="xv"><b>{(e.est * 100).toFixed(1)}</b><small> ±{(196 * e.se).toFixed(1)}</small></div>
          <div className="xs"><small>{pct(r.weightedShare)} of people → {pct(arr(g))} of {svc} events</small></div>
        </div>); })}
      <p className="note">Why it matters in the game: the bottom line of each row is your patient mix. Groups that use care more per person arrive more often than their population share, and each pays differently (see payments below). ⚠ = small sample, treat with caution.</p>
    </section>
  );
}

export function SpendingLesson({ ctl }: { ctl: Controller }) {
  const i = ctl.asset.insights; if (!i) return null; const c = i.spendingConcentration;
  return (
    <section className="card">
      <h3>Who drives spending? <Badge kind="MEPS_OBSERVED" /></h3>
      {[['Top 1% of people', c.top1], ['Top 5%', c.top5], ['Top 10%', c.top10], ['Top 50%', c.top50]].map(([k, v]) => (
        <div className="bars" key={k as string}><div className="bar"><span>{k}</span><i style={{ width: `${(v as number) * 100}%` }} className="pc-private" /><b>{pct(v as number, 0)}</b></div></div>))}
      <div className="kv"><span>Mean spend per person</span><b>{usd(i.meanTotalExpenditureUSD * 100)}</b></div>
      <div className="kv"><span>Median spend per person</span><b>{usd(i.medianTotalExpenditureUSD * 100)}</b></div>
      <div className="kv"><span>People with zero spending</span><b>{pct(i.zeroExpenditureShare, 1)}</b></div>
      <p className="note">Spending is extremely skewed: that is why the game samples each visit's payment from the full distribution, and why a few inpatient stays matter more than many visits.</p>
    </section>
  );
}

export function MethodsPrimer() {
  return (
    <section className="card">
      <h3>Methods in 60 seconds</h3>
      <details><summary>Why survey weights?</summary><p className="note">MEPS interviews ~19,000 people. Each person's weight (PERWT24F) says how many Americans they represent (~340M total), so statistics describe the whole civilian noninstitutionalized population, not just the sample.</p></details>
      <details><summary>What is a confidence interval here?</summary><p className="note">MEPS is a complex multi-stage sample. We use its strata and cluster variables (VARSTR, VARPSU) and Taylor linearization to get design-based standard errors. A 95% interval is estimate ± 1.96 SE.</p></details>
      <details><summary>Payments are not revenue</summary><p className="note">MEPS records what payers and families paid for care. It does not record a hospital's charges, costs or profit, so the game combines MEPS payments with clearly-labelled cost assumptions.</p></details>
      <details><summary>From national survey to your hospital</summary><p className="note">The catchment size and hospital share are game assumptions. MEPS tells us how often people like those in the community use care and what is paid; the game scales that to one hospital.</p></details>
    </section>
  );
}
