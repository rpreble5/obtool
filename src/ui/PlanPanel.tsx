import { useState } from 'react';
import type { Plan, PlanItem } from '../protocol/engine';
import { gaFormat, gaShort, gaDays, tierAction, testingModality, type RiskTier } from '../protocol/types';

const TIER_LABEL: Record<RiskTier, string> = {
  all: 'Standard',
  moderate: 'Moderate risk',
  high: 'High risk',
  veryHigh: 'Very high risk',
};

const CAT_LABEL: Record<string, string> = {
  visit: 'Visit',
  lab: 'Lab',
  imaging: 'Imaging',
  immunization: 'Vaccine',
  medication: 'Medication',
  counseling: 'Counsel',
  referral: 'Referral',
  monitoring: 'Monitor',
  delivery: 'Delivery',
  documentation: 'Admin',
};

const tierVar = (t: RiskTier) => `var(--t-${t})`;

function timingLabel(item: PlanItem): string {
  const t = item.timing;
  switch (t.kind) {
    case 'once':
      return gaDays(t.start) === gaDays(t.end)
        ? gaFormat(t.start)
        : `${gaFormat(t.start)} – ${gaFormat(t.end)}`;
    case 'span':
      return `${gaFormat(t.start)} – ${gaFormat(t.end)}`;
    case 'recurring':
      return t.interval;
    case 'atDiagnosis':
      return 'On diagnosis';
    case 'everyVisit':
      return 'Every visit';
  }
}

function Item({ item }: { item: PlanItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`item${item.suppressedBy ? ' suppressed' : ''}`}>
      <button className="item-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="item-cat">{CAT_LABEL[item.category] ?? item.category}</span>
        <span className="item-title">{item.title}</span>
        {item.suppressedBy && <span className="item-flag">Removed</span>}
        {item.provisional && !item.suppressedBy && <span className="item-flag">Assumed</span>}
        {item.source.origin === 'standardGuidance' && (
          <span className="item-flag added">Added</span>
        )}
      </button>

      {open && (
        <div className="item-body">
          {item.detail && (
            <>
              <p className="lbl">What to do</p>
              <p>{item.detail}</p>
            </>
          )}

          <p className="lbl">Why</p>
          <p className="why">{item.rationale}</p>

          {item.suppressedBy && (
            <div className="assumption">
              Removed by <b>{item.suppressedBy.title}</b>. {item.suppressedBy.rationale}
            </div>
          )}

          {item.assumption && (
            <div className="assumption">
              <b>Assuming:</b> {item.assumption}
            </div>
          )}

          {item.pendingDecisions?.map((d, i) => (
            <div className="decision" key={i}>
              <b>{d.at ? `At ${gaFormat(d.at)} — ` : ''}{d.question}</b>
              <ul>
                {d.branches.map((br, j) => (
                  <li key={j}>
                    <i>{br.condition}</i>
                    <span>{br.then}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <p className="lbl">Protocol</p>
          <p>{item.source.text}</p>
          <cite>
            {item.source.origin === 'standardGuidance'
              ? `Not in the FMC document — ${item.source.section}`
              : `FMC OB Patient Care, ${item.source.section}, p.${item.source.page}`}
          </cite>
        </div>
      )}
    </div>
  );
}

export function PlanPanel({ plan }: { plan: Plan }) {
  const scheduled = [...plan.items, ...plan.suppressed].filter(
    (i) => i.timing.kind !== 'atDiagnosis' && i.timing.kind !== 'everyVisit',
  );
  const ongoing = plan.items.filter(
    (i) => i.timing.kind === 'atDiagnosis' || i.timing.kind === 'everyVisit',
  );

  const byWeek = new Map<number, PlanItem[]>();
  for (const i of scheduled) {
    const t = i.timing;
    const w = 'start' in t ? Math.floor(gaDays(t.start) / 7) : 0;
    byWeek.set(w, [...(byWeek.get(w) ?? []), i]);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  const conflict = plan.deliveryConflict;

  return (
    <div className="pane">
      <p className="pane-title">Consolidated plan</p>

      {plan.careTransferred && (
        <div className="callout transfer">
          <h4>Care transfers out of family medicine</h4>
          <p>
            {plan.careTransferred.title}. The plan below is shown for reference, but
            management does not stay with the FM clinic.
          </p>
        </div>
      )}

      <div className="callout">
        <h4 style={{ color: tierVar(plan.tier.tier) }}>
          {TIER_LABEL[plan.tier.tier]} — {tierAction[plan.tier.tier]}
        </h4>
        {plan.allTiers.length === 0 ? (
          <p>No risk factors entered yet. Standard family medicine clinic care.</p>
        ) : (
          <ul className="tier-list">
            {plan.allTiers.flatMap((t) =>
              t.reasons.map((r) => (
                <li key={r.ruleId}>
                  <span className="tag" style={{ color: tierVar(t.tier) }}>
                    {TIER_LABEL[t.tier]}
                  </span>
                  <span>{r.reason}</span>
                </li>
              )),
            )}
          </ul>
        )}
      </div>

      {conflict && conflict.windows.length > 0 && (
        <div className={`callout${conflict.windows.length > 1 ? ' warn' : ''}`}>
          <h4>
            {conflict.windows.length > 1
              ? `${conflict.windows.length} delivery windows apply`
              : 'Delivery window'}
          </h4>
          {conflict.windows.length > 1 && (
            <p>
              These come from different indications and do not agree. The tightest is
              marked — the synthesis is yours to make.
            </p>
          )}
          <div className="dwin">
            {conflict.windows.map((w) => {
              const lo = w.delivery.earliest ? gaDays(w.delivery.earliest) / 7 : 36;
              const hi = w.delivery.latest ? gaDays(w.delivery.latest) / 7 : 42;
              const pct = (x: number) => ((x - 34) / 8) * 100;
              const tightest = w.ruleId === conflict.tightestRuleId;
              return (
                <div className="dwin-row" key={w.ruleId}>
                  <div className="dwin-label">
                    <span>{w.delivery.indication}</span>
                    <span className="rng">
                      {w.delivery.earliest ? gaShort(w.delivery.earliest) : '—'}
                      {' → '}
                      {w.delivery.latest ? gaShort(w.delivery.latest) : '—'}
                    </span>
                  </div>
                  <div className="dwin-track">
                    <div
                      className={`dwin-bar${tightest ? ' tightest' : ''}`}
                      style={{ left: `${pct(lo)}%`, width: `${Math.max(pct(hi) - pct(lo), 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="dwin-scale">
              <span>34w</span>
              <span>36w</span>
              <span>38w</span>
              <span>40w</span>
              <span>42w</span>
            </div>
          </div>
        </div>
      )}

      {plan.testing && (
        <div className="callout">
          <h4>Antenatal testing — {testingModality(plan.testing.frequency)}</h4>
          <p>
            Starts {gaFormat(plan.testing.start)}, consolidated from{' '}
            {plan.testing.sources.length} indication
            {plan.testing.sources.length === 1 ? '' : 's'}:{' '}
            {plan.testing.sources
              .map((s) => `${s.title} (${gaFormat(s.testing.start)})`)
              .join(', ')}
            . The earliest start and highest frequency win.
          </p>
        </div>
      )}

      {weeks.length === 0 ? (
        <div className="empty">Enter a dating input to build the plan.</div>
      ) : (
        <div className="spine">
          {weeks.map((w) => (
            <div className="wk" key={w}>
              <div className="wk-mark">{w}w</div>
              <div className="wk-items">
                {byWeek.get(w)!.map((i) => (
                  <Item key={i.ruleId} item={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ongoing.length > 0 && (
        <div className="ungated">
          <p className="pane-title">Not tied to a gestational age</p>
          <div style={{ display: 'grid', gap: 5 }}>
            {ongoing.map((i) => (
              <Item key={i.ruleId} item={i} />
            ))}
          </div>
        </div>
      )}

      {plan.conditional.length > 0 && (
        <div className="ungated">
          <p className="pane-title">Applies only if confirmed</p>
          <div style={{ display: 'grid', gap: 5 }}>
            {plan.conditional.map((i) => (
              <Item key={i.ruleId} item={i} />
            ))}
          </div>
        </div>
      )}

      {plan.openQuestions.length > 0 && (
        <div className="callout" style={{ marginTop: 14 }}>
          <h4>Open questions</h4>
          <p>
            Nothing above is waiting on these. Each item states what it assumed;
            answering refines the plan rather than unlocking it.
          </p>
          <ul className="tier-list">
            {plan.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { timingLabel };
