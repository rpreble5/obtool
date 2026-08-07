import type { Plan, PlanItem } from '../protocol/engine';
import { gaDays, gaShort } from '../protocol/types';

/**
 * The dedicated timeline view.
 *
 * Same spine as the plan panel, rotated horizontal. Lanes are categories, and
 * the delivery lane is where conflicting windows become obvious without
 * needing to be explained.
 *
 * Items within a lane are packed into sub-rows so nothing overlaps — a label
 * hidden underneath another bar is worse than no label at all.
 */

const START = 0;
const END = 42;
const pct = (week: number) => ((week - START) / (END - START)) * 100;

/** Weeks of timeline roughly covered by one character of label, at typical width. */
const CHAR_WEEKS = 0.42;
/** Anything spanning most of the pregnancy is shown as an "any time" band. */
const AMBIENT_SPAN = 28;

interface Placed {
  key: string;
  lo: number;
  hi: number;
  label: string;
  title: string;
  point: boolean;
  ambient: boolean;
  row: number;
}

/** Past this week a right-hand label would overflow, so it flips to the left. */
const FLIP_AFTER = 30;

/** First-fit packing: each item drops into the topmost row it clears. */
function pack(raw: Omit<Placed, 'row'>[]): { placed: Placed[]; rows: number } {
  const rowEnds: number[] = [];
  const placed: Placed[] = [];
  for (const item of [...raw].sort((a, b) => a.lo - b.lo || b.hi - a.hi)) {
    // Reserve enough width for the label so text never runs under a neighbour.
    const needed = item.point
      ? item.lo + 0.9 + item.label.length * CHAR_WEEKS
      : Math.max(item.hi, item.lo + item.label.length * CHAR_WEEKS);
    let row = rowEnds.findIndex((end) => item.lo >= end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[row] = needed + 0.4;
    placed.push({ ...item, row });
  }
  return { placed, rows: Math.max(rowEnds.length, 1) };
}

function toPlaced(item: PlanItem): Omit<Placed, 'row'> | null {
  const t = item.timing;
  if (t.kind === 'atDiagnosis' || t.kind === 'everyVisit') return null;
  const lo = gaDays(t.start) / 7;
  // A recurring item with no stated end runs to delivery, so it is drawn as a
  // band rather than collapsing to a point at its start week.
  const hi =
    'end' in t && t.end
      ? Math.max(gaDays(t.end) / 7, lo)
      : t.kind === 'recurring'
        ? END
        : lo;
  return {
    key: item.ruleId,
    lo,
    hi,
    label: item.title,
    title: `${item.title} — ${gaShort(t.start)}${
      'end' in t && t.end ? ` to ${gaShort(t.end)}` : ''
    }`,
    point: hi - lo <= 1,
    ambient: hi - lo >= AMBIENT_SPAN,
  };
}

const LANES: { key: string; label: string; cats: string[] }[] = [
  { key: 'visits', label: 'Visits', cats: ['visit'] },
  { key: 'labs', label: 'Labs', cats: ['lab'] },
  { key: 'imaging', label: 'Imaging', cats: ['imaging'] },
  { key: 'vaccines', label: 'Vaccines', cats: ['immunization'] },
  { key: 'meds', label: 'Medications', cats: ['medication'] },
  { key: 'monitoring', label: 'Monitoring', cats: ['monitoring', 'counseling'] },
  { key: 'admin', label: 'Referral / admin', cats: ['referral', 'documentation'] },
];

const ROW_H = 22;
const PAD = 7;

function Lane({
  label,
  raw,
  today,
  variant = 'normal',
  tightestKey,
}: {
  label: string;
  raw: Omit<Placed, 'row'>[];
  today: number | null;
  variant?: 'normal' | 'decision' | 'delivery';
  tightestKey?: string;
}) {
  if (raw.length === 0) return null;
  const { placed, rows } = pack(raw);
  const height = rows * ROW_H + PAD;

  return (
    <div className="tl-lane">
      <b>{label}</b>
      <div className="tl-track" style={{ height }}>
        {today !== null && today >= 0 && today <= END && (
          <div className="tl-today" style={{ left: `${pct(today)}%` }} />
        )}
        {placed.map((p) => {
          const top = PAD / 2 + p.row * ROW_H;
          if (variant === 'decision') {
            return (
              <div
                className="tl-pt diamond"
                key={p.key}
                style={{ left: `${pct(p.lo)}%`, top: top + 3 }}
                title={p.title}
              />
            );
          }
          if (p.point) {
            const flip = p.lo > FLIP_AFTER;
            return (
              <div key={p.key} title={p.title}>
                <div className="tl-pt" style={{ left: `${pct(p.lo)}%`, top: top + 3 }} />
                <span
                  className={`tl-ptlabel${flip ? ' flip' : ''}`}
                  style={
                    flip
                      ? { right: `calc(${100 - pct(p.lo)}% + 10px)`, top }
                      : { left: `calc(${pct(p.lo)}% + 10px)`, top }
                  }
                >
                  {p.label}
                </span>
              </div>
            );
          }
          if (variant === 'delivery') {
            return (
              <div key={p.key} title={p.title}>
                <div
                  className={`tl-bar delivery${p.key === tightestKey ? ' tightest' : ''}`}
                  style={{
                    left: `${pct(p.lo)}%`,
                    width: `${Math.max(pct(p.hi) - pct(p.lo), 1.2)}%`,
                    top,
                  }}
                />
                <span
                  className="tl-ptlabel flip"
                  style={{ right: `calc(${100 - pct(p.lo)}% + 8px)`, top }}
                >
                  {p.label}
                </span>
              </div>
            );
          }
          return (
            <div
              className={'tl-bar' + (p.ambient ? ' ambient' : '')}
              key={p.key}
              style={{
                left: `${pct(p.lo)}%`,
                width: `${Math.max(pct(p.hi) - pct(p.lo), 1.2)}%`,
                top,
              }}
              title={p.title}
            >
              <span>{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Timeline({ plan }: { plan: Plan }) {
  const today = plan.dating ? plan.dating.currentGaDays / 7 : null;
  const conflict = plan.deliveryConflict;

  const bands = [
    { label: 'First trimester', span: 13 },
    { label: 'Second trimester', span: 14 },
    { label: 'Third trimester', span: 15 },
  ];

  const decisions = plan.items.flatMap((i) =>
    (i.pendingDecisions ?? [])
      .filter((d) => d.at)
      .map((d, k) => ({
        key: `${i.ruleId}-${k}`,
        lo: gaDays(d.at!) / 7,
        hi: gaDays(d.at!) / 7,
        label: d.question,
        title: `${gaShort(d.at!)} — ${d.question}`,
        point: true,
        ambient: false,
      })),
  );

  const deliveries =
    conflict?.windows.map((w) => {
      const lo = w.delivery.earliest ? gaDays(w.delivery.earliest) / 7 : 36;
      const hi = w.delivery.latest ? gaDays(w.delivery.latest) / 7 : 42;
      return {
        key: w.ruleId,
        lo,
        hi,
        label: w.delivery.indication,
        title: `${w.delivery.indication}: ${
          w.delivery.earliest ? gaShort(w.delivery.earliest) : '—'
        } to ${w.delivery.latest ? gaShort(w.delivery.latest) : '—'}`,
        point: false,
        ambient: false,
      };
    }) ?? [];

  return (
    <div className="tl-wrap">
      <div className="tl">
        <div className="tl-tri">
          {bands.map((b) => (
            <div key={b.label} style={{ gridColumn: `span ${b.span}` }}>
              {b.label}
            </div>
          ))}
        </div>

        <div className="tl-axis">
          {Array.from({ length: 42 }, (_, i) => (
            <span key={i}>{i % 2 === 0 ? i : ''}</span>
          ))}
        </div>

        {today !== null && today >= 0 && today <= END && (
          <div className="tl-todaylane">
            <span className="lbl" style={{ left: `${pct(today)}%` }}>
              today · {plan.dating!.currentGaLabel}
            </span>
          </div>
        )}

        {LANES.map((lane) => (
          <Lane
            key={lane.key}
            label={lane.label}
            today={today}
            raw={plan.items
              .filter((i) => lane.cats.includes(i.category))
              .map(toPlaced)
              .filter((x): x is Omit<Placed, 'row'> => x !== null)}
          />
        ))}

        <Lane label="Decision points" raw={decisions} today={today} variant="decision" />
        <Lane
          label="Delivery"
          raw={deliveries}
          today={today}
          variant="delivery"
          tightestKey={conflict?.tightestRuleId}
        />

        <div className="tl-legend">
          <i>
            <span className="sw" style={{ background: 'var(--accent)' }} /> Scheduled item
          </i>
          <i>
            <span className="sw ambient-sw" /> Any time in pregnancy
          </i>
          <i>
            <span className="sw diamond-sw" /> Decision point
          </i>
          <i>
            <span className="sw" style={{ background: 'var(--t-high)' }} /> Delivery window
          </i>
          <i>
            <span className="sw" style={{ background: 'var(--t-veryHigh)' }} /> Tightest constraint
          </i>
        </div>

        {conflict && conflict.windows.length > 1 && (
          <div className="tl-conflict">
            <h4>Delivery windows do not agree</h4>
            {conflict.windows.map((w) => (
              <div className="tl-conflict-row" key={w.ruleId}>
                <span>{w.delivery.indication}</span>
                <span className="rng">
                  {w.delivery.earliest ? gaShort(w.delivery.earliest) : '—'} →{' '}
                  {w.delivery.latest ? gaShort(w.delivery.latest) : '—'}
                  {w.ruleId === conflict.tightestRuleId && ' · tightest'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
