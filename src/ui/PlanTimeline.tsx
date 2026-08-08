import { useState } from 'react';
import type { Plan, PlanItem } from '../protocol/engine';
import { gaDays, gaShort, tierAction, testingModality, type RiskTier } from '../protocol/types';

/**
 * The plan as a vertical timeline.
 *
 * Gestational age runs down the centre. Care every pregnancy gets sits on the
 * left; everything this patient gets *because of her risk factors* sits on the
 * right. The point is that the right-hand column is the answer to "what is
 * different about this patient" — readable without counting anything.
 *
 * Rows are one per week that has content, not to scale. A to-scale axis would
 * put 20 weeks of whitespace between the anatomy scan and the GTT.
 *
 * As on the intake board, nothing here may move when something is clicked:
 * item detail opens in a fixed-height strip, never inline.
 */

const TIER_LABEL: Record<RiskTier, string> = {
  all: 'Standard',
  moderate: 'Moderate risk',
  high: 'High risk',
  veryHigh: 'Very high risk',
};

const CAT_LABEL: Record<string, string> = {
  visit: 'visit',
  lab: 'lab',
  imaging: 'imaging',
  immunization: 'vaccine',
  medication: 'med',
  counseling: 'counsel',
  referral: 'referral',
  monitoring: 'monitor',
  delivery: 'delivery',
  documentation: 'admin',
};

interface Row {
  week: number;
  left: PlanItem[];
  right: PlanItem[];
}

function startWeek(i: PlanItem): number | null {
  const t = i.timing;
  if (t.kind === 'atDiagnosis' || t.kind === 'everyVisit') return null;
  return Math.floor(gaDays(t.start) / 7);
}

function Chip({
  item,
  side,
  selected,
  onSelect,
}: {
  item: PlanItem;
  side: 'left' | 'right';
  selected: boolean;
  onSelect: () => void;
}) {
  const cls = [
    'chip',
    side,
    item.standard ? 'std' : 'add',
    item.suppressedBy ? 'removed' : '',
    selected ? 'sel' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} onClick={onSelect} title={item.title}>
      <span className="chip-cat">{CAT_LABEL[item.category] ?? item.category}</span>
      <span className="chip-title">{item.title}</span>
    </button>
  );
}

export function PlanTimeline({ plan }: { plan: Plan }) {
  const [selected, setSelected] = useState<string | null>(null);

  const all = [...plan.items, ...plan.suppressed];
  const scheduled = all.filter((i) => startWeek(i) !== null);
  const ongoing = all.filter((i) => startWeek(i) === null);

  const byWeek = new Map<number, Row>();
  for (const i of scheduled) {
    const w = startWeek(i)!;
    const row = byWeek.get(w) ?? { week: w, left: [], right: [] };
    (i.standard ? row.left : row.right).push(i);
    byWeek.set(w, row);
  }

  // Delivery windows sit on the right at the week they open.
  const deliveries = plan.deliveryConflict?.windows ?? [];
  for (const w of deliveries) {
    const wk = w.delivery.earliest ? Math.floor(gaDays(w.delivery.earliest) / 7) : 39;
    if (!byWeek.has(wk)) byWeek.set(wk, { week: wk, left: [], right: [] });
  }

  const rows = [...byWeek.values()].sort((a, b) => a.week - b.week);
  const todayWeek = plan.dating && plan.dating.currentGaDays >= 0
    ? plan.dating.currentGaDays / 7
    : null;

  const sel = all.find((i) => i.ruleId === selected);

  const trimester = (w: number) => (w < 14 ? 'T1' : w < 28 ? 'T2' : 'T3');

  return (
    <div className="pane plan">
      {/* Tier: one compact strip rather than a stack of callouts. */}
      <div className="tierstrip" style={{ borderColor: `var(--t-${plan.tier.tier})` }}>
        <span className="tierstrip-badge" style={{ color: `var(--t-${plan.tier.tier})` }}>
          {TIER_LABEL[plan.tier.tier]}
        </span>
        <span className="tierstrip-action">{tierAction[plan.tier.tier]}</span>
        <span className="tierstrip-why">
          {plan.allTiers.flatMap((t) => t.reasons.map((r) => r.reason)).join(' · ') ||
            'No risk factors entered'}
        </span>
      </div>

      {/* Fixed height, same pattern as the intake context strip. */}
      <div className="detail">
        {sel ? (
          <>
            <div className="detail-head">
              <span className={`detail-side ${sel.standard ? 'std' : 'add'}`}>
                {sel.standard ? 'Standard' : 'Additional'}
              </span>
              <b>{sel.title}</b>
              {sel.suppressedBy && <span className="detail-flag">Removed</span>}
              {sel.source.origin === 'standardGuidance' && (
                <span className="detail-flag">Not in protocol</span>
              )}
            </div>
            <div className="detail-body">
              {sel.detail && <p>{sel.detail}</p>}
              <p className="why">{sel.rationale}</p>
              {sel.suppressedBy && (
                <p className="why">
                  Removed by <b>{sel.suppressedBy.title}</b>. {sel.suppressedBy.rationale}
                </p>
              )}
              {sel.assumption && <p className="why"><b>Assuming:</b> {sel.assumption}</p>}
              {sel.pendingDecisions?.map((d, k) => (
                <p key={k} className="why">
                  <b>{d.at ? `At ${gaShort(d.at)}: ` : ''}{d.question}</b>{' '}
                  {d.branches.map((br) => `${br.condition} → ${br.then}`).join(' · ')}
                </p>
              ))}
              <cite>
                {sel.source.origin === 'standardGuidance'
                  ? `Not in the FMC document — ${sel.source.section}`
                  : `FMC OB Patient Care, ${sel.source.section}, p.${sel.source.page}`}
              </cite>
            </div>
          </>
        ) : (
          <p className="detail-hint">
            Left of the line is what every pregnancy gets. Right of the line is what
            this patient gets because of her risk factors. Click anything for the
            reasoning.
          </p>
        )}
      </div>

      <div className="tlv-head">
        <span>Standard care</span>
        <span />
        <span>Additional for this patient</span>
      </div>

      <div className="tlv">
        {rows.map((row) => {
          const crossedToday =
            todayWeek !== null &&
            row.week >= todayWeek &&
            !rows.some((r) => r.week >= todayWeek && r.week < row.week);
          const rowDeliveries = deliveries.filter(
            (d) =>
              (d.delivery.earliest ? Math.floor(gaDays(d.delivery.earliest) / 7) : 39) ===
              row.week,
          );
          return (
            <div key={row.week}>
              {crossedToday && (
                <div className="tlv-today">
                  <span />
                  <b>today · {plan.dating!.currentGaLabel}</b>
                  <span />
                </div>
              )}
              <div className="tlv-row">
                <div className="tlv-left">
                  {row.left.map((i) => (
                    <Chip
                      key={i.ruleId}
                      item={i}
                      side="left"
                      selected={selected === i.ruleId}
                      onSelect={() => setSelected(i.ruleId)}
                    />
                  ))}
                </div>
                <div className="tlv-axis">
                  {/* Modifier is `blank`, not `empty`: there is a generic
                      .empty rule in the stylesheet whose padding would set a
                      border-box floor of 42px on this 7px dot. */}
                  <i className={`dot ${row.left.length || row.right.length ? '' : 'blank'}`} />
                  <span className="wk">{row.week}w</span>
                  <span className="tri">{trimester(row.week)}</span>
                </div>
                <div className="tlv-right">
                  {row.right.map((i) => (
                    <Chip
                      key={i.ruleId}
                      item={i}
                      side="right"
                      selected={selected === i.ruleId}
                      onSelect={() => setSelected(i.ruleId)}
                    />
                  ))}
                  {rowDeliveries.map((d) => (
                    <div
                      key={d.ruleId}
                      className={`chip right delivery${
                        d.ruleId === plan.deliveryConflict?.tightestRuleId ? ' tightest' : ''
                      }`}
                      title={d.delivery.indication}
                    >
                      <span className="chip-cat">deliver</span>
                      <span className="chip-title">
                        {d.delivery.earliest ? gaShort(d.delivery.earliest) : '—'}–
                        {d.delivery.latest ? gaShort(d.delivery.latest) : '—'} ·{' '}
                        {d.delivery.indication}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {deliveries.length > 1 && (
        <div className="conflictnote">
          <b>{deliveries.length} delivery windows apply and do not agree.</b> Tightest is{' '}
          {(() => {
            const t = deliveries.find((d) => d.ruleId === plan.deliveryConflict?.tightestRuleId);
            return t ? `${t.delivery.indication} (by ${gaShort(t.delivery.latest!)})` : '—';
          })()}
          . The synthesis is yours to make.
        </div>
      )}

      {plan.testing && (
        <div className="testingnote">
          <b>Antenatal testing — {testingModality(plan.testing.frequency)}</b> from{' '}
          {gaShort(plan.testing.start)}, consolidated from {plan.testing.sources.length}{' '}
          indication{plan.testing.sources.length === 1 ? '' : 's'}: earliest start and
          highest frequency win.
        </div>
      )}

      {ongoing.length > 0 && (
        <>
          <div className="tlv-head sub">
            <span>Standard</span>
            <span />
            <span>Additional</span>
          </div>
          <div className="tlv">
            <div className="tlv-row">
              <div className="tlv-left">
                {ongoing.filter((i) => i.standard).map((i) => (
                  <Chip key={i.ruleId} item={i} side="left" selected={selected === i.ruleId} onSelect={() => setSelected(i.ruleId)} />
                ))}
              </div>
              <div className="tlv-axis">
                <span className="wk any">any</span>
              </div>
              <div className="tlv-right">
                {ongoing.filter((i) => !i.standard).map((i) => (
                  <Chip key={i.ruleId} item={i} side="right" selected={selected === i.ruleId} onSelect={() => setSelected(i.ruleId)} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
