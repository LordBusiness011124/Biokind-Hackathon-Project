import { useMemo, useState } from 'react';
import { END_YEAR, type AnnualSnapshot, type BandSummary } from '@hospital/sim';
import { runBands, runControl, type Controller } from '../controller';
import { usd, pct, hrs, num } from '../format';

function Spark({ pts, color }: { pts: number[]; color: string }) {
  const w = 300, h = 60, mn = Math.min(...pts, 0), mx = Math.max(...pts, 1), rng = mx - mn || 1;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1)) * w},${h - ((v - mn) / rng) * h}`).join('');
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" role="img" aria-label="Cash by year"><path d={d} fill="none" stroke={color} strokeWidth="2" /><line x1="0" x2={w} y1={h - ((0 - mn) / rng) * h} y2={h - ((0 - mn) / rng) * h} stroke="#64748b" strokeDasharray="3" /></svg>;
}

export function YearEndReport({ ctl }: { ctl: Controller }) {
  const s = ctl.sim.state, r = ctl.report!, all = s.snapshots, last = ctl.gameOver;
  const [cmp, setCmp] = useState<AnnualSnapshot[] | null>(null);
  const [bands, setBands] = useState<BandSummary | null>(null);
  const [prog, setProg] = useState(0);
  const ctlRun = useMemo(() => (cmp ? cmp : null), [cmp]);
  const treated = r.treated.emergency + r.treated.outpatient, arr = r.arrivals.emergency + r.arrivals.outpatient;
  const sum = (xs: AnnualSnapshot[], f: (x: AnnualSnapshot) => number) => xs.reduce((t, x) => t + f(x), 0);
  const stats = (xs: AnnualSnapshot[]) => ({ net: sum(xs, (x) => x.netCents), treated: sum(xs, (x) => x.treated.emergency + x.treated.outpatient), unmet: sum(xs, (x) => x.unmetDemand),
    wait: sum(xs, (x) => x.avgWaitTicks * (x.treated.emergency + x.treated.outpatient)) / Math.max(1, sum(xs, (x) => x.treated.emergency + x.treated.outpatient)), cash: xs.at(-1)?.cashCents ?? 0,
    oop: sum(xs, (x) => x.patientOopCents) / Math.max(1, sum(xs, (x) => x.treated.emergency + x.treated.outpatient)) });
  const me = stats(all), co = ctlRun ? stats(ctlRun) : null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Year end report">
      <div className="modal wide">
        <h2>{s.bankrupt ? `Bankrupt in ${r.year}` : last ? `Final report: ${all[0].year}–${r.year}` : `Year ${r.year} report`}</h2>
        {r.mode === 'DEMO_SYNTHETIC' && <div className="banner demo">DEMO MODE: SYNTHETIC PLACEHOLDER DATA</div>}
        <div className="grid4">
          <div className="tile"><span>Net result</span><b className={r.netCents < 0 ? 'neg' : 'pos'}>{usd(r.netCents)}</b><small>rev {usd(r.revenueCents, true)} − cost {usd(r.expensesCents, true)}</small></div>
          <div className="tile"><span>Cash</span><b className={r.cashCents < 0 ? 'neg' : ''}>{usd(r.cashCents)}</b><small>start {usd(r.cashStartCents, true)}</small></div>
          <div className="tile"><span>Access</span><b>{pct(arr ? treated / arr : 1)}</b><small>{num(treated)} of {num(arr)} treated · avg wait {hrs(r.avgWaitTicks)}</small></div>
          <div className="tile"><span>Affordability</span><b>{usd(r.avgOopPerVisitCents)}</b><small>avg patient out-of-pocket/visit · {usd(r.subsidizedOopCents, true)} assisted</small></div>
        </div>
        {r.unmet.emergency > 0 && <div className="banner warn">⚠ {num(r.unmet.emergency)} ER patients waited over {ctl.sim.a.queue.emergencyDiversionWaitTicks} h and were modelled as transferred / left unseen. Add ER capacity: an overloaded ER is a safety problem, not a saving.</div>}
        {r.unmet.outpatient > 0 && <div className="banner warn">⚠ {num(r.unmet.outpatient)} clinic patients left without being seen.</div>}
        <h3>Your patients vs the MEPS population <small>(who actually arrived, compared with who lives in the community)</small></h3>
        <table className="tbl"><thead><tr><th>Insurance</th><th>MEPS population share (95% CI)</th><th>Share of your arrivals</th><th>Over/under-use</th></tr></thead><tbody>
          {(['private', 'medicare', 'medicaid', 'uninsured', 'other'] as const).map((k) => { const ds = ctl.asset.designBased?.payerShare[k], tot = Object.values(r.byPayer).reduce((t, g) => t + g.arrivals, 0) || 1, mine = (r.byPayer[k]?.arrivals ?? 0) / tot; return (
            <tr key={k}><td>{k}</td><td>{ds ? `${(ds.est * 100).toFixed(1)}% ±${(196 * ds.se).toFixed(1)}` : '-'}</td><td>{pct(mine, 1)}</td><td>{ds ? `${(mine / ds.est).toFixed(2)}×` : '-'}</td></tr>); })}
        </tbody></table>
        <p className="note">Above 1× means that group arrives more often than its population share, because MEPS shows it uses more care per person (see the MEPS Lab). Your <i>mix of arrivals</i> comes from MEPS; <i>how you serve it</i> is the simulation.</p>
        {ctl.literacy.asked > 0 && <div className="banner ok">Data IQ: {ctl.literacy.correct} of {ctl.literacy.asked} briefing questions correct · {usd(ctl.literacy.grantsCents)} in data-literacy grants (included in revenue).</div>}
        <h3>Equity: access and waits by insurance <small>(simulated outcomes; groups under 30 arrivals are unreliable)</small></h3>
        <table className="tbl"><thead><tr><th>Payer</th><th>Arrivals</th><th>Treated</th><th>Unmet</th><th>Avg wait</th><th>Avg OOP</th></tr></thead><tbody>
          {Object.entries(r.byPayer).sort().map(([k, g]) => (<tr key={k}><td>{k}{g.arrivals < 30 ? ' ⚠' : ''}</td><td>{g.arrivals}</td><td>{g.treated}</td><td>{g.unmet}</td><td>{g.treated ? hrs(g.waitTicksSum / g.treated) : '-'}</td><td>{g.treated ? usd(g.oopCents / g.treated) : '-'}</td></tr>))}
        </tbody></table>
        <table className="tbl"><thead><tr><th>Income</th><th>Arrivals</th><th>Unmet</th><th>Avg wait</th><th>Avg OOP</th></tr></thead><tbody>
          {Object.entries(r.byIncome).sort().map(([k, g]) => (<tr key={k}><td>{k}</td><td>{g.arrivals}</td><td>{g.unmet}</td><td>{g.treated ? hrs(g.waitTicksSum / g.treated) : '-'}</td><td>{g.treated ? usd(g.oopCents / g.treated) : '-'}</td></tr>))}
        </tbody></table>
        <h3>Ledger ({r.year})</h3>
        <div className="ledger">{Object.entries(r.ledger).filter(([, v]) => v).map(([k, v]) => <span key={k}>{k}: <b>{usd(v)}</b></span>)}</div>
        <p className="note">Check: cash start {usd(r.cashStartCents)} + revenue − costs = {usd(r.cashStartCents + r.revenueCents - r.expensesCents)} = cash end {usd(r.cashCents)}</p>
        {all.length > 1 && (<>
          <h3>Cash by year</h3><Spark pts={all.map((x) => x.cashCents)} color="#14b8a6" />
          <p className="note">{all.length} annual snapshots{last && !s.bankrupt ? ` (${all[0].year}–${END_YEAR})` : ''}. Scenario drift and prices are model assumptions, not forecasts.</p>
        </>)}
        {all.length > 0 && (<>
          <h3>Your decisions vs. no intervention <small>(same seed, same arrivals, no actions)</small></h3>
          {!co ? <button onClick={() => setCmp(runControl(ctl.asset, s.config.seed, all.length))}>Run control comparison</button> : (
            <table className="tbl"><thead><tr><th></th><th>You</th><th>No intervention</th></tr></thead><tbody>
              <tr><td>Cumulative net</td><td>{usd(me.net)}</td><td>{usd(co.net)}</td></tr>
              <tr><td>Final cash</td><td>{usd(me.cash)}</td><td>{usd(co.cash)}</td></tr>
              <tr><td>Patients treated</td><td>{num(me.treated)}</td><td>{num(co.treated)}</td></tr>
              <tr><td>Unmet (transferred/left)</td><td>{num(me.unmet)}</td><td>{num(co.unmet)}</td></tr>
              <tr><td>Avg wait</td><td>{hrs(me.wait)}</td><td>{hrs(co.wait)}</td></tr>
              <tr><td>Avg patient OOP/visit</td><td>{usd(me.oop)}</td><td>{usd(co.oop)}</td></tr>
            </tbody></table>)}
          <p className="note">Both branches share one random stream; only decisions differ. Illustrates modelled tradeoffs, not causal evidence.</p>
        </>)}
        {all.length > 0 && (<>
          <h3>How much is luck? <small>(your decisions, 20 other random seeds)</small></h3>
          {!bands ? <button disabled={prog > 0} onClick={async () => setBands(await runBands(ctl.asset, s.actionLog, all.length, 20, setProg))}>{prog > 0 ? `Running… ${prog}/20` : 'Run 20-seed uncertainty bands'}</button> : (
            <table className="tbl"><thead><tr><th></th><th>10th pct</th><th>Median</th><th>90th pct</th></tr></thead><tbody>
              <tr><td>Final cash</td><td>{usd(bands.finalCash.p10, true)}</td><td>{usd(bands.finalCash.median, true)}</td><td>{usd(bands.finalCash.p90, true)}</td></tr>
              <tr><td>Cumulative net</td><td>{usd(bands.cumulativeNet.p10, true)}</td><td>{usd(bands.cumulativeNet.median, true)}</td><td>{usd(bands.cumulativeNet.p90, true)}</td></tr>
              <tr><td>Patients treated</td><td>{num(bands.treated.p10)}</td><td>{num(bands.treated.median)}</td><td>{num(bands.treated.p90)}</td></tr>
              <tr><td>Unmet (transferred/left)</td><td>{num(bands.unmet.p10)}</td><td>{num(bands.unmet.median)}</td><td>{num(bands.unmet.p90)}</td></tr>
              <tr><td>Avg wait</td><td>{hrs(bands.avgWaitTicks.p10)}</td><td>{hrs(bands.avgWaitTicks.median)}</td><td>{hrs(bands.avgWaitTicks.p90)}</td></tr>
              <tr><td>Went bankrupt</td><td colSpan={3}>{pct(bands.bankruptShare)} of {bands.runs} runs</td></tr>
            </tbody></table>)}
          <p className="note">Variation from simulation randomness only (arrivals, payments, severities). These are not MEPS confidence intervals; those are on the Data tab.</p>
        </>)}
        <div className="row">
          {last ? <button className="primary" onClick={() => ctl.restart()}>New game</button> : <button className="primary" onClick={() => ctl.dismissReport()}>Continue to {r.year + 1} →</button>}
        </div>
      </div>
    </div>
  );
}
