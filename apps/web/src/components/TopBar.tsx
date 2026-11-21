import { SPEEDS, type Controller } from '../controller';
import { END_YEAR } from '@hospital/sim';
import { usd, num } from '../format';

export function TopBar({ ctl }: { ctl: Controller }) {
  const s = ctl.sim.state, acc = s.yearAcc;
  const treated = acc.treated.emergency + acc.treated.outpatient;
  const waiting = s.departments.emergency.queue.length + s.departments.outpatient.queue.length;
  const day = Math.floor((s.tick - s.yearStartTick) / 24) + 1;
  return (
    <header className="topbar">
      <div className="stat"><span>YEAR</span><b>{s.year}</b><small>day {Math.min(day, 365)} · to {END_YEAR}</small></div>
      <div className={`stat ${s.cashCents < 0 ? 'neg' : ''}`}><span>CASH</span><b>{usd(s.cashCents)}</b></div>
      <div className="stat"><span>TREATED (YTD)</span><b>{num(treated)}</b></div>
      <div className="stat"><span>WAITING</span><b>{waiting}</b></div>
      {ctl.literacy.asked > 0 && <div className="stat"><span>MEPS IQ</span><b>{ctl.literacy.correct}/{ctl.literacy.asked}</b><small>briefing answers</small></div>}
      <div className={`stat mode ${ctl.isDemo ? 'demo' : 'real'}`}><span>DATA</span><b>{ctl.isDemo ? 'DEMO SYNTHETIC' : 'MEPS 2024'}</b></div>
      <div className="controls" role="group" aria-label="Simulation speed">
        <button onClick={() => ctl.togglePause()} aria-pressed={ctl.paused}>{ctl.paused ? '▶ Play' : '❚❚ Pause'}</button>
        {SPEEDS.map((sp) => <button key={sp} className={!ctl.paused && ctl.speed === sp ? 'on' : ''} onClick={() => ctl.setSpeed(sp)}>{sp}x</button>)}
        <button onClick={() => ctl.toggleMute()} aria-pressed={ctl.muted} title="Toggle sound (M)">{ctl.muted ? '🔇' : '🔊'}</button>
        <button onClick={() => ctl.simToYearEnd()} disabled={ctl.gameOver}>Sim to year-end</button>
        <button onClick={() => ctl.simTo2044()} disabled={ctl.gameOver}>Sim to {END_YEAR}</button>
      </div>
    </header>
  );
}
