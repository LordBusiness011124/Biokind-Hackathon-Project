import { coachTips } from '@hospital/sim';
import type { Controller } from '../controller';
import { Badge } from './Badge';

export function CoachCard({ ctl }: { ctl: Controller }) {
  const tips = coachTips(ctl.sim);
  return (
    <section className="card coach">
      <h3>Data Coach <small>MEPS-grounded advice</small></h3>
      {tips.map((t) => (
        <div key={t.id} className={`tip tip-${t.severity}`}>
          <b>{t.severity === 'warn' ? '⚠ ' : t.severity === 'good' ? '✓ ' : 'ℹ '}{t.title}</b>
          <p className="fact"><Badge kind={ctl.isDemo ? 'DEMO_SYNTHETIC' : 'MEPS_CALIBRATED'} /> {t.meps}</p>
          <p className="note">{t.advice}</p>
          {t.tab === 'data' && <button onClick={() => ctl.openTab('data')}>Open MEPS Lab</button>}
        </div>))}
    </section>
  );
}
