import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Controller } from './controller';
import { Game } from './game/Game';
import { OBJECTS } from './game/objects';
import { TopBar } from './components/TopBar';
import { ManagePanel } from './components/ManagePanel';
import { DataInsightsPanel } from './components/DataInsightsPanel';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { YearEndReport } from './components/YearEndReport';
import { BriefingModal } from './components/BriefingModal';
import { DecisionModal } from './components/DecisionModal';
import { WhyMeps } from './components/WhyMeps';
import { HowToPlay } from './components/HowToPlay';
import { Onboarding } from './components/Onboarding';

const TABS = [['manage', 'Manage'], ['data', 'MEPS Lab'], ['why', 'Why MEPS'], ['about', 'About']] as const;

export default function App() {
  const ctl = useMemo(() => new Controller(2024), []);
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  if (import.meta.env.DEV) (window as unknown as { __ctl: Controller }).__ctl = ctl;
  const [tab, setTab] = useState<string>('manage');
  const [intro, setIntro] = useState(true);
  useEffect(() => { ctl.start(); return () => ctl.stop(); }, [ctl]);
  useEffect(() => { if (ctl.focusTab) setTab(ctl.focusTab); }, [ctl.tabNonce, ctl.focusTab]);
  const warn = ctl.sim.state.yearAcc.unmet.emergency;
  return (
    <div className="app">
      {ctl.isDemo && <div className="banner demo top">DEMO MODE: SYNTHETIC PLACEHOLDER DATA. MEPS CALIBRATION NOT YET LOADED.</div>}
      <TopBar ctl={ctl} />
      <main className="main">
        <div className="stage">
          <div className="stage-heading"><h2>Hospital campus</h2><span className="status">{ctl.paused ? 'Simulation paused' : 'Simulation running'}</span></div>
          <Game ctl={ctl} />
          <p className="stage-help"><span>Go to:</span>{OBJECTS.map((o) => <button key={o.id} onClick={() => ctl.goTo(o.id)} title={o.label}><kbd>{o.key}</kbd> {o.short}</button>)}<span>Click any object or patient · scroll to zoom</span></p>
        </div>
        <aside className="side">
          <nav role="tablist">{TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>
          {tab === 'manage' && <ManagePanel ctl={ctl} />}
          {tab === 'data' && <DataInsightsPanel ctl={ctl} />}
          {tab === 'why' && <WhyMeps ctl={ctl} />}
          {tab === 'about' && <AssumptionsPanel ctl={ctl} />}
        </aside>
      </main>
      <footer className="ticker" aria-live="polite">{warn > 0 && <b className="warn-chip">⚠ ER overloaded: {warn} transferred/left unseen this year</b>}{ctl.messages.slice(0, 3).map((m, i) => <span key={i}>{m}</span>)}</footer>
      {ctl.showHelp && <HowToPlay ctl={ctl} />}
      {intro && <Onboarding ctl={ctl} onClose={() => setIntro(false)} />}
      {!intro && ctl.briefing && !ctl.report && <BriefingModal ctl={ctl} />}
      {!intro && ctl.report && <YearEndReport ctl={ctl} />}
      {!intro && !ctl.briefing && !ctl.report && !ctl.gameOver && (ctl.sim.state.pendingCard || ctl.decisionResult) && <DecisionModal ctl={ctl} />}
    </div>
  );
}
