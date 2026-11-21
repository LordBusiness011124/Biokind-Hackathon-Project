import type { Controller } from '../controller';

const COLOR = (v: number) => (v >= 80 ? 'var(--green)' : v >= 60 ? 'var(--amber)' : 'var(--red)');

export function Objectives({ ctl }: { ctl: Controller }) {
  const c = ctl.card, w = ctl.sim.a.scoring.weights;
  return (<>{c.objectives.map((o) => (
    <div className="obj" key={o.id}>
      <div className="row"><span>{o.label} <small>({Math.round(w[o.id] * 100)}%)</small></span><b style={{ color: COLOR(o.score) }}>{Math.round(o.score)}</b></div>
      <div className="meter"><i style={{ width: `${o.score}%`, background: COLOR(o.score) }} /></div>
      <small>{o.detail}. Goal: {o.target}.</small>
    </div>))}</>);
}

/** Live "Mission" card in the Manage tab: the goal, the running grade and the six objectives. */
export function MissionCard({ ctl }: { ctl: Controller }) {
  const c = ctl.card, ev = ctl.sim.state.yearEvent;
  return (
    <section className="card mission">
      <h3>Your mission <small>keep the doors open, treat everyone fairly, reach 2044</small></h3>
      {ev && <div className="banner warn">Event this year: <b>{ev.label}</b>. {ev.description}</div>}
      {c.years === 0 ? <p className="note">Your grade appears after the first year closes. You are scored on six objectives, not just cash. Press <b>? Help</b> for the full guide.</p> : (<>
        <div className="grade"><b style={{ color: COLOR(c.total) }}>{c.grade}</b><span>running grade · {Math.round(c.total)}/100 after {c.years} year{c.years === 1 ? '' : 's'}</span></div>
        <details><summary>See the six objectives</summary><Objectives ctl={ctl} /></details></>)}
    </section>
  );
}

/** Scorecard block used in the year-end / final report. */
export function ScoreCard({ ctl, final }: { ctl: Controller; final: boolean }) {
  const c = ctl.card;
  return (
    <section className="card">
      <h3>{final ? 'Final administrator grade' : 'Running grade'}</h3>
      <div className="grade big"><b style={{ color: COLOR(c.total) }}>{c.grade}</b><span>{Math.round(c.total)}/100 · {c.survived ? `${c.years} years` : 'went bankrupt'}</span></div>
      <Objectives ctl={ctl} />
      <p className="note">Weights and thresholds are game-design assumptions. Grade = weighted average of the six objectives.</p>
    </section>
  );
}
