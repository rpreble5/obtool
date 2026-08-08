import { useMemo, useState } from 'react';
import type { PatientProfile } from './protocol/patient';
import { generatePlan } from './protocol/engine';
import { PROTOCOL_META } from './protocol/rules';
import { tierAction, type RiskTier } from './protocol/types';
import { IntakeBoard } from './ui/IntakeBoard';
import { PlanTimeline } from './ui/PlanTimeline';
import { Timeline } from './ui/Timeline';

const TIER_LABEL: Record<RiskTier, string> = {
  all: 'Standard',
  moderate: 'Moderate risk',
  high: 'High risk',
  veryHigh: 'Very high risk',
};

export function App() {
  const [profile, setProfile] = useState<PatientProfile>({
    lmp: '2026-01-05',
    plurality: 'singleton',
  });
  const [view, setView] = useState<'plan' | 'timeline'>('plan');

  const plan = useMemo(() => generatePlan(profile), [profile]);
  const tier = plan.tier.tier;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          OB Care Planner
          <span>{PROTOCOL_META.documentTitle} · edit {PROTOCOL_META.edit}</span>
        </div>

        <div className="dating">
          <label htmlFor="lmp">LMP</label>
          <input
            id="lmp"
            type="date"
            value={profile.lmp ?? ''}
            onChange={(e) => setProfile({ ...profile, lmp: e.target.value })}
          />
        </div>

        <div className="ga-readout">
          {plan.dating?.currentGaLabel ?? '—'}
          <small>
            {plan.dating ? `EDD ${plan.dating.edd.toLocaleDateString()}` : 'no dating'}
          </small>
        </div>

        <div className="spacer" />

        <span className="tier-badge" style={{ color: `var(--t-${tier})` }} title={tierAction[tier]}>
          <span className="dot" />
          {TIER_LABEL[tier]}
        </span>

        <div className="viewtabs" role="tablist">
          <button role="tab" aria-selected={view === 'plan'} onClick={() => setView('plan')}>
            Plan
          </button>
          <button role="tab" aria-selected={view === 'timeline'} onClick={() => setView('timeline')}>
            Timeline
          </button>
        </div>
      </header>

      {view === 'plan' ? (
        <div className="split">
          <IntakeBoard profile={profile} onChange={setProfile} />
          <PlanTimeline plan={plan} />
        </div>
      ) : (
        <Timeline plan={plan} />
      )}
    </>
  );
}
