import type { Controller } from '../controller';

export function Onboarding({ ctl, onClose }: { ctl: Controller; onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="modal">
        <h2>Hospital Tycoon: 2044</h2>
        <p className="lead">Run a hospital on real MEPS survey data, and see who pays the price for care.</p>
        {ctl.isDemo && <div className="banner demo">DEMO MODE: SYNTHETIC PLACEHOLDER DATA. MEPS CALIBRATION NOT YET LOADED.</div>}
        <ul className="short">
          <li><b>Goal:</b> stay open, serve everyone, be fair, earn trust.</li>
          <li><b>Each year:</b> answer a data quiz, make one board decision, run the year.</li>
          <li><b>Move:</b> click an object on the map, or press <kbd>1</kbd>–<kbd>6</kbd>.</li>
        </ul>
        <label className="chk"><input type="checkbox" checked={ctl.challenge} onChange={(e) => ctl.setChallenge(e.target.checked)} /> Challenge mode: random yearly events (optional)</label>
        <div className="row">
          <button className="primary" onClick={() => { onClose(); ctl.openBriefing(true); }}>Start 2024</button>
          <button onClick={() => ctl.setHelp(true)}>How to play</button>
          <button onClick={() => { onClose(); ctl.openTab('why'); }}>Why MEPS matters first</button>
          {ctl.hasSave() && <button onClick={() => { ctl.load(); onClose(); }}>Continue saved game</button>}
        </div>
      </div>
    </div>
  );
}
