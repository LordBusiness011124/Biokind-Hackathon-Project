import type { Controller } from '../controller';
import { END_YEAR } from '@hospital/sim';

const OBJECTIVES = [
  ['Stay open', 'Never go bankrupt. Finish with more cash than you started.'],
  ['Serve everyone', 'Treat nearly every patient and keep the ER safe.'],
  ['Be fair', 'Similar waits and costs for every insurance and income group.'],
  ['Earn trust', 'Good care brings more patients. Neglect sends them away.'],
] as const;

export function HowToPlay({ ctl }: { ctl: Controller }) {
  const w = ctl.sim.a.scoring.weights, pc = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play" style={{ zIndex: 60 }}>
      <div className="modal wide how">
        <h2>How to play</h2>
        <p className="lead">Run a hospital from 2024 to {END_YEAR}. You are graded on <b>fairness and survival</b>, not on cash.</p>

        <h3>Your 4 objectives</h3>
        <div className="objgrid">{OBJECTIVES.map(([t, d], i) => <div className="objbox" key={t}><b>{i + 1}. {t}</b><span>{d}</span></div>)}</div>

        <h3>Each year</h3>
        <ol className="steps">
          <li><b>Answer</b> 2 questions about the MEPS data.</li>
          <li><b>Decide</b> the board’s dilemma. Not deciding picks the default.</li>
          <li><b>Run</b> the year: hire staff, build beds, fund assistance.</li>
          <li><b>Review</b> your report, then repeat.</li>
        </ol>

        <h3>Controls</h3>
        <p><b>Click an object</b> on the map (or press <kbd>1</kbd>–<kbd>6</kbd>) to walk there and open its panel. <kbd>Space</kbd> pauses · <kbd>M</kbd> mutes · scroll zooms.</p>

        <h3>Your grade</h3>
        <p className="weights">Finance {pc(w.finance)} · Access {pc(w.access)} · ER safety {pc(w.safety)} · Equity {pc(w.equity)} · Affordability {pc(w.affordability)} · Trust {pc(w.trust)} · Data IQ {pc(w.dataIq)}</p>
        <p className="note">Tip: start with the Data Coach in Manage. Doing nothing bankrupts you. Optional Challenge mode adds random yearly events.</p>

        <div className="row"><button className="primary" onClick={() => ctl.setHelp(false)}>Got it</button></div>
      </div>
    </div>
  );
}
