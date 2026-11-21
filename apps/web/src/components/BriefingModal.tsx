import type { Controller } from '../controller';
import { PLAYABLE } from '@hospital/sim';
import { num, usd } from '../format';
import { Badge } from './Badge';

export function BriefingModal({ ctl }: { ctl: Controller }) {
  const b = ctl.briefing!, sim = ctl.sim, exp = sim.expectedAnnualArrivals(), rates = ctl.asset.designBased?.ratesPerPersonYear;
  const done = b.picked.every((x) => x !== null);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`MEPS briefing ${b.year}`}>
      <div className="modal wide">
        <h2>MEPS briefing · {b.year}</h2>
        <p className="note">Your community is built from the 2024 Medical Expenditure Panel Survey. Predict the data, then see what it says. Each correct answer earns a {usd(2_500_000)} data-literacy grant <Badge kind="MODEL_ASSUMPTION" />.</p>
        {sim.state.yearEvent && <div className="banner warn">Event this year: <b>{sim.state.yearEvent.label}</b>. {sim.state.yearEvent.description} <Badge kind="MODEL_ASSUMPTION" /></div>}
        <div className="card">
          <h3>What MEPS implies for your {b.year}</h3>
          <div className="grid4">{PLAYABLE.map((s) => (
            <div className="tile" key={s}><span>{s} arrivals</span><b>{num(exp[s])}</b>
              <small>{rates ? `${(rates[s].est * 100).toFixed(1)} per 100 people/yr` : ''} × {num(sim.population())} × {(sim.a.hospitalShare[s] * 100).toFixed(0)}% share</small></div>))}</div>
        </div>
        {b.questions.map((q, qi) => {
          const pick = b.picked[qi], ok = pick === q.answerIndex;
          return (
            <div className="card" key={q.id + qi}>
              <h3>Question {qi + 1} <Badge kind={q.kind} /></h3>
              <p>{q.prompt}</p>
              <div className="opts">{q.options.map((o, oi) => (
                <button key={o} disabled={pick !== null} className={pick === null ? '' : oi === q.answerIndex ? 'right' : oi === pick ? 'wrong' : ''} onClick={() => ctl.answer(qi, oi)}>{o}</button>))}</div>
              {pick !== null && (<div className={`reveal ${ok ? 'ok' : 'no'}`} aria-live="polite">
                <b>{ok ? `Correct! +${usd(2_500_000)} grant` : 'Not quite.'}</b>
                <p>{q.explain}</p><p className="note">{q.stat}</p><p className="note">Source: {q.source}</p></div>)}
            </div>);
        })}
        <div className="row">
          <button className="primary" onClick={() => ctl.closeBriefing()}>{done ? `Start ${b.year} →` : 'Skip briefing →'}</button>
          <small>Data IQ so far: {ctl.literacy.correct}/{ctl.literacy.asked}</small>
        </div>
      </div>
    </div>
  );
}
