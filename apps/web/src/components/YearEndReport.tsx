import { useMemo, useState } from 'react';
import { END_YEAR, type AnnualSnapshot } from '@hospital/sim';
import { runControl, type Controller } from '../controller';
import { usd, pct, hrs, num } from '../format';

function Spark({ pts, color }: { pts: number[]; color: string }) {
  const w = 300, h = 60, mn = Math.min(...pts, 0), mx = Math.max(...pts, 1), rng = mx - mn || 1;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1)) * w},${h - ((v - mn) / rng) * h}`).join('');
  return <svg viewBox={`0 0 ${w} ${h}`} className="spark" role="img" aria-label="Cash by year"><path d={d} fill="none" stroke={color} strokeWidth="2" /><line x1="0" x2={w} y1={h - ((0 - mn) / rng) * h} y2={h - ((0 - mn) / rng) * h} stroke="#64748b" strokeDasharray="3" /></svg>;
}

export function YearEndReport({ ctl }: { ctl: Controller }) {
  const s = ctl.sim.state, r = ctl.report!, all = s.snapshots, last = ctl.gameOver;
  const [cmp, setCmp] = useState<AnnualSnapshot[] | null>(null);
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
        <div className="row">
          {last ? <button className="primary" onClick={() => ctl.restart()}>New game</button> : <button className="primary" onClick={() => ctl.dismissReport()}>Continue to {r.year + 1} →</button>}
        </div>
      </div>
    </div>
  );
}
