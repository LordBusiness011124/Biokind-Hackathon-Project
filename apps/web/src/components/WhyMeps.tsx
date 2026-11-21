import type { Controller } from '../controller';
import { PAYERS, PLAYABLE } from '@hospital/sim';
import { pct, usd, num } from '../format';
import { Badge } from './Badge';

/** Explains why MEPS is vital to the game, with live numbers from the loaded asset (nothing here is hard-coded data). */
export function WhyMeps({ ctl }: { ctl: Controller }) {
  const a = ctl.asset, sim = ctl.sim, ins = a.insights, db = a.designBased, demo = ctl.isDemo;
  if (demo || !ins || !db) return <div className="panel-body"><div className="banner demo">The MEPS asset is not loaded, so there is nothing to explain yet. Run <code>npm run data</code> to build it from the real files.</div></div>;

  const er = a.payments.emergency, pooledMean = er.pooled.facilityPaymentCents.mean, pooledMedian = er.pooled.facilityPaymentCents.quantiles[10];
  const use = sim.payerMix('emergency'), pop = a.marginals.payerShare;
  const revPerVisit = (mix: Record<string, number>) => { const t = PAYERS.reduce((s, p) => s + (mix[p] ?? 0), 0) || 1; return PAYERS.reduce((s, p) => s + ((mix[p] ?? 0) / t) * er.byPayer[p].facilityPaymentCents.mean, 0); };
  const expArr = sim.expectedAnnualArrivals().emergency;
  const meps = revPerVisit(use) * expArr, ignoreUse = revPerVisit(pop) * expArr, ignoreSkew = pooledMedian * expArr, flatAvg = pooledMean * expArr;
  const g = ins.ratesAndSpendingByGroup, ageR = g.ageBand['65+'].emergency.est / g.ageBand['0-17'].emergency.est;
  const c = ins.spendingConcentration, ipMean = a.payments.inpatient.pooled.facilityPaymentCents.mean, erMean = pooledMean;
  const diff = (x: number) => { const d = (x - meps) / meps; return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}%`; };

  return (
    <div className="panel-body why">
      <section className="card">
        <h3>The short version</h3>
        <p>A hospital game needs to answer three questions: <b>who shows up, how often, and who pays what</b>. Without real data those answers are guesses, and a game built on guesses teaches nothing. <b>MEPS answers all three</b>, from the same people, in the same year, which is why the whole game is built on it.</p>
        <p className="note">Everything on this page is computed live from the MEPS asset you are playing with.</p>
      </section>

      <section className="card">
        <h3>What is MEPS? <Badge kind="MEPS_OBSERVED" /></h3>
        <p className="note">The Medical Expenditure Panel Survey, run by the US Agency for Healthcare Research and Quality (AHRQ). It follows a nationally representative sample of {num(a.counts.personsPositiveWeight)} people in the civilian noninstitutionalized population (standing for about {(a.counts.weightedPopulation / 1e6).toFixed(0)}M Americans) and records, for the same person, their <b>age, insurance, income, every ER visit, outpatient visit and hospital stay, and who paid for each</b>. Linking who someone is to what care they used and what was paid is what makes it so valuable.</p>
      </section>

      <section className="card">
        <h3>Where MEPS drives the game</h3>
        <table className="tbl"><thead><tr><th>In the game</th><th>From MEPS</th><th>Live value</th></tr></thead><tbody>
          <tr><td>Who lives in the community</td><td>Weighted age × insurance × income cells (PERWT24F)</td><td>{pct(pop.private)} private · {pct(pop.medicare)} Medicare · {pct(pop.medicaid)} Medicaid · {pct(pop.uninsured)} uninsured</td></tr>
          {PLAYABLE.map((s) => <tr key={s}><td>{s === 'emergency' ? 'ER' : s === 'outpatient' ? 'Clinic' : 'Ward'} arrivals</td><td>{s === 'emergency' ? 'ERTOT24' : s === 'outpatient' ? 'OPTOTV24' : 'IPDIS24'} per person-year</td><td>{(db.ratesPerPersonYear[s].est * 100).toFixed(1)} per 100 people → {num(sim.expectedAnnualArrivals()[s])} arrivals/yr</td></tr>)}
          <tr><td>What each visit pays</td><td>Event files HC-254D/E/F facility payments by payer</td><td>ER: private {usd(er.byPayer.private.facilityPaymentCents.mean)}, Medicaid {usd(er.byPayer.medicaid.facilityPaymentCents.mean)}</td></tr>
          <tr><td>Ward stay length</td><td>HC-254D NUMNIGHX</td><td>{a.payments.inpatient.pooled.nights?.mean.toFixed(1)} nights on average</td></tr>
          <tr><td>Affordability</td><td>Facility self-pay (…FSF24X) by payer</td><td>uninsured ER own payment avg {usd(er.byPayer.uninsured.facilityOutOfPocketCents.mean)}</td></tr>
          <tr><td>Quiz, coach, lab, confidence intervals</td><td>VARSTR / VARPSU design-based SEs</td><td>every statistic shown with its uncertainty</td></tr>
        </tbody></table>
      </section>

      <section className="card">
        <h3>Why it is vital: four things you would get wrong without it</h3>

        <h4>1. Who arrives is not who lives there</h4>
        <p className="note">Older people use far more care. MEPS: 65+ have <b>{ageR.toFixed(1)}×</b> the ER visit rate of children. Medicare beneficiaries are {pct(pop.medicare)} of people but {pct(use.medicare ?? 0)} of your ER arrivals (see the explorer). A game that sampled patients to match the population would under-staff for older, higher-use patients.</p>

        <h4>2. Spending is wildly skewed</h4>
        <p className="note">The top 10% of people account for <b>{pct(c.top10)}</b> of spending; the median person spent {usd(ins.medianTotalExpenditureUSD * 100)} against a mean of {usd(ins.meanTotalExpenditureUSD * 100)}. One inpatient stay pays <b>{(ipMean / erMean).toFixed(0)}×</b> an ER visit ({usd(ipMean)} vs {usd(erMean)}). That is why the ward decides whether the hospital survives, and why the game draws each payment from the full distribution rather than using averages.</p>

        <h4>3. The payer decides the revenue</h4>
        <p className="note">An ER visit pays {usd(er.byPayer.private.facilityPaymentCents.mean)} for private insurance but {usd(er.byPayer.medicare.facilityPaymentCents.mean)} for Medicare and {usd(er.byPayer.medicaid.facilityPaymentCents.mean)} for Medicaid. Your payer mix is therefore your business model, and the equity tradeoff (treat everyone equally while some pay far less) is real, not invented.</p>

        <h4>4. Every estimate has uncertainty</h4>
        <p className="note">MEPS is a sample, so each number comes with a confidence interval: uninsured share {pct(db.payerShare.uninsured.est, 1)} ± {(196 * db.payerShare.uninsured.se).toFixed(1)}pp; ER visits {(db.ratesPerPersonYear.emergency.est * 100).toFixed(1)} ± {(196 * db.ratesPerPersonYear.emergency.se).toFixed(1)} per 100 people. Good data work reports the range, and so does this game.</p>
      </section>

      <section className="card">
        <h3>Try it: what if the game ignored MEPS?</h3>
        <p className="note">Your expected ER facility revenue this year, with {num(expArr)} expected arrivals, under different shortcuts <Badge kind="SIMULATED" />:</p>
        <table className="tbl"><thead><tr><th>Method</th><th>Expected ER revenue</th><th>vs MEPS method</th></tr></thead><tbody>
          <tr><td><b>MEPS method</b>: use-weighted payer mix × payer-specific payments</td><td>{usd(meps)}</td><td>baseline</td></tr>
          <tr><td>Ignore who uses care (population shares)</td><td>{usd(ignoreUse)}</td><td>{diff(ignoreUse)}</td></tr>
          <tr><td>Ignore skew (use the median payment)</td><td>{usd(ignoreSkew)}</td><td>{diff(ignoreSkew)}</td></tr>
          <tr><td>One average payment for everyone (right total, but blind to who pays)</td><td>{usd(flatAvg)}</td><td>{diff(flatAvg)}</td></tr>
        </tbody></table>
        <p className="note">The first two shortcuts sound reasonable yet miss badly; the size of the miss is the information MEPS adds. A flat average gets the total about right but erases who pays what, so the game could not show payer mix, equity or affordability at all. These gaps compound across ER, clinic and ward for 21 years.</p>
      </section>

      <section className="card">
        <h3>What MEPS cannot tell you (honest limits)</h3>
        <ul className="note">
          <li>It covers the civilian noninstitutionalized population, not any particular hospital or catchment: size and hospital share are game assumptions.</li>
          <li>Payments are what payers and families paid, <b>not</b> hospital revenue, charges, cost or profit: costs are labelled assumptions.</li>
          <li>It is one year (2024). The path to 2044 is a scenario with editable assumptions, not a forecast.</li>
          <li>Small groups have wide intervals (see the ⚠ marks); the game shows the sample size.</li>
          <li>It describes people and payments, not clinical quality or outcomes, so the game never invents mortality or treatment effects.</li>
        </ul>
      </section>

      <section className="card">
        <h3>Where to go next</h3>
        <div className="row wrap"><button onClick={() => ctl.openTab('data')}>Explore the data in the MEPS Lab</button><button onClick={() => ctl.openTab('manage')}>Back to your hospital</button></div>
        <p className="note">Source: <a href="https://meps.ahrq.gov/mepsweb/" target="_blank" rel="noreferrer">AHRQ MEPS</a> (HC-256, HC-254D/E/F). Not endorsed by AHRQ.</p>
      </section>
    </div>
  );
}
