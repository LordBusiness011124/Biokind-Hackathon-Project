import type { Controller } from '../controller';
import { END_YEAR } from '@hospital/sim';
import { Badge } from './Badge';

export function HowToPlay({ ctl }: { ctl: Controller }) {
  const w = ctl.sim.a.scoring.weights, pc = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play" style={{ zIndex: 60 }}>
      <div className="modal wide how">
        <h2>How to play</h2>

        <h3>The goal</h3>
        <p>Run a community hospital from <b>2024 to {END_YEAR}</b>. You win by <b>keeping it open and fair</b>: stay solvent, treat nearly everyone who comes, keep the ER safe, give every insurance group similar care, and keep care affordable. Making the most cash is <i>not</i> the goal. You get a letter grade on six objectives.</p>

        <h3>What a year looks like</h3>
        <ol>
          <li><b>MEPS briefing.</b> Predict a real statistic from the survey, see the answer and its confidence interval, earn a small grant if right.</li>
          <li><b>Run the year.</b> Patients arrive, queue, get treated and pay. Pause, or use 1x / 3x / 10x. Change staffing and buildings any time.</li>
          <li><b>Year-end report.</b> Cash, access, affordability, equity, and how your patients compare with the MEPS population.</li>
          <li><b>Repeat</b> through {END_YEAR}. Prices, wages, population and ageing drift each year (scenario assumptions).</li>
        </ol>

        <h3>Controls</h3>
        <ul>
          <li><b>WASD / arrows</b> walk your administrator. <b>E</b> uses a nearby desk or console (admin desk and consoles open Manage, reception board opens the MEPS Lab, kiosk explains why MEPS matters). <b>Space</b> pause · <b>M</b> mute · <b>wheel</b> zoom · <b>click a patient</b> to see their modelled visit.</li>
        </ul>

        <h3>Your levers (Manage tab)</h3>
        <ul>
          <li><b>Hire or fire</b> physicians and nurses. A treatment post needs both, and capacity is the minimum of rooms, physicians and nurses.</li>
          <li><b>Build rooms or beds.</b> The <b>inpatient ward</b> starts closed and is where the biggest payments are.</li>
          <li><b>Process improvement</b> shortens treatment times. <b>Financial assistance fund</b> pays low-income and uninsured patients' out-of-pocket costs.</li>
          <li>The <b>Data Coach</b> turns MEPS numbers into advice. Follow its warnings first.</li>
        </ul>

        <h3>How you are graded</h3>
        <table className="tbl"><thead><tr><th>Objective</th><th>Weight</th><th>Goal</th></tr></thead><tbody>
          <tr><td>Financial viability</td><td>{pc(w.finance)}</td><td>Stay solvent; finish with more cash than you started</td></tr>
          <tr><td>Access</td><td>{pc(w.access)}</td><td>Treat at least 99% of arrivals</td></tr>
          <tr><td>Emergency safety</td><td>{pc(w.safety)}</td><td>Do not transfer ER or ward patients away</td></tr>
          <tr><td>Equity</td><td>{pc(w.equity)}</td><td>Similar waits for every insurance group</td></tr>
          <tr><td>Affordability</td><td>{pc(w.affordability)}</td><td>Relieve out-of-pocket costs for low-income patients</td></tr>
          <tr><td>Data IQ</td><td>{pc(w.dataIq)}</td><td>Answer MEPS briefing questions correctly</td></tr>
        </tbody></table>
        <p className="note">Weights are game design <Badge kind="MODEL_ASSUMPTION" />. Going bankrupt (cash below zero for 60 days) ends the game with zero financial score.</p>

        <h3>What you should get out of playing</h3>
        <ul>
          <li><b>Real data has structure.</b> Who uses care depends on age, insurance and income, and that is why your patient mix is not the community mix.</li>
          <li><b>Averages mislead.</b> A few big spenders dominate; the median patient looks nothing like the mean. Payments come from the whole distribution.</li>
          <li><b>Who pays shapes the business.</b> Private, Medicare, Medicaid and uninsured patients pay very different amounts for the same visit, which creates real fairness tradeoffs.</li>
          <li><b>Capacity, queues and safety trade off against cost.</b> Under-staffing saves money until patients are turned away.</li>
          <li><b>Uncertainty is part of the answer.</b> Read confidence intervals and sample sizes, and see how much is luck versus your decisions.</li>
          <li><b>Scenarios are not forecasts.</b> The path to 2044 shows how assumptions change outcomes, and every assumption is labelled.</li>
        </ul>

        <h3>Good first moves</h3>
        <ul><li>Read the Data Coach. Doing nothing slowly bankrupts you, so trim idle clinic capacity, open the ward, and watch ER waits.</li>
          <li>Try the <b>Why MEPS</b> tab, then play a full run and compare your result with the no-intervention branch.</li></ul>

        <h3>Challenge mode</h3>
        <p>Optional (choose it on the intro screen): seeded yearly events such as a flu season, a recession or a staffing shortage. Events are the same whatever you decide, so runs stay comparable. They are scenario assumptions, not predictions.</p>

        <div className="row"><button className="primary" onClick={() => ctl.setHelp(false)}>Got it</button></div>
      </div>
    </div>
  );
}
