import type { Controller } from '../controller';
export function Onboarding({ ctl, onClose }: { ctl: Controller; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="modal">
        <h2>Hospital Tycoon: 2044</h2>
        <p>Welcome to 2024. Your hospital serves a synthetic community based on U.S. MEPS survey patterns. Your job is to keep the doors open while treating patients fairly.</p>
        {ctl.isDemo && <div className="banner demo">DEMO MODE: SYNTHETIC PLACEHOLDER DATA. MEPS CALIBRATION NOT YET LOADED.</div>}
        <ul>
          <li><b>Move</b> your administrator with WASD / arrow keys. <b>E</b> near a desk or console opens the panel. <b>Space</b> pauses, <b>M</b> mutes, mouse wheel zooms.</li>
          <li><b>Hire staff, build rooms and open the inpatient ward, fund efficiency or patient assistance</b> in the Manage tab. Doing nothing slowly bankrupts the hospital; the ward is where the money is. Waiting patients you can't serve in time are lost, and an overloaded ER is a safety problem.</li>
          <li>Open <b>Data</b> to see why these patients arrive and what they pay. Click a patient on the map for their modelled visit.</li>
          <li><b>MEPS is your guide.</b> Each year opens with a short data briefing: predict a real statistic from the survey, see the answer with its confidence interval, and earn a small grant for getting it right. The <b>Data Coach</b> in Manage turns MEPS rates into staffing advice, and the <b>MEPS Lab</b> lets you explore who uses care and what payers pay.</li>
          <li>Finish each year with a scorecard covering cash, access, affordability and equity, through <b>2044</b>.</li>
        </ul>
        <p className="note">Scenario game, not a forecast. Everything not survey-derived is labelled MODEL ASSUMPTION.</p>
        <div className="row">
          <button className="primary" onClick={() => { onClose(); ctl.openBriefing(true); }}>Start 2024</button>
          {ctl.hasSave() && <button onClick={() => { ctl.load(); onClose(); }}>Continue saved game</button>}
        </div>
      </div>
    </div>
  );
}
