import type {
  Condition,
  DeliveryRecommendation,
  GA,
  PendingDecision,
  Rule,
  RiskTier,
  Source,
  Timing,
  AntenatalTesting,
  RuleCategory,
} from './types';
import { gaDays } from './types';
import type { PatientProfile } from './patient';
import { RULES } from './rules';

// ---------------------------------------------------------------------------
// Three-valued evaluation
// ---------------------------------------------------------------------------

/**
 * Conditions evaluate to true, false, or `provisional`.
 *
 * `provisional` is the whole point of the design: a rule whose trigger depends
 * on something not yet known still appears on the plan, marked, running on its
 * stated assumption. The plan is never blocked behind a question.
 */
export type Eval = true | false | 'provisional';

const isTrue = (e: Eval): boolean => e === true;

function evaluate(
  cond: Condition,
  p: PatientProfile,
  answers: Record<string, boolean>,
): Eval {
  if ('always' in cond) return true;

  if ('all' in cond) {
    const parts = cond.all.map((c) => evaluate(c, p, answers));
    if (parts.some((x) => x === false)) return false;
    if (parts.some((x) => x === 'provisional')) return 'provisional';
    return true;
  }

  if ('any' in cond) {
    const parts = cond.any.map((c) => evaluate(c, p, answers));
    if (parts.some((x) => x === true)) return true;
    if (parts.some((x) => x === 'provisional')) return 'provisional';
    return false;
  }

  if ('not' in cond) {
    const inner = evaluate(cond.not, p, answers);
    if (inner === 'provisional') return 'provisional';
    return !inner;
  }

  if ('atLeast' in cond) {
    const parts = cond.of.map((c) => evaluate(c, p, answers));
    const definite = parts.filter((x) => x === true).length;
    if (definite >= cond.atLeast) return true;
    const possible = definite + parts.filter((x) => x === 'provisional').length;
    return possible >= cond.atLeast ? 'provisional' : false;
  }

  if ('askUser' in cond) {
    const answer = answers[cond.askUser];
    return answer === undefined ? 'provisional' : answer;
  }

  const value = (p as Record<string, unknown>)[cond.field];
  // An unset field cannot satisfy a comparison. It is reported separately as
  // missing information rather than being treated as a negative finding.
  if (value === undefined || value === null) return false;

  if ('eq' in cond) return value === cond.eq;
  if ('in' in cond) return cond.in.includes(value as string | number);
  if (typeof value !== 'number') return false;
  if ('gt' in cond) return value > cond.gt;
  if ('gte' in cond) return value >= cond.gte;
  if ('lt' in cond) return value < cond.lt;
  if ('lte' in cond) return value <= cond.lte;
  return false;
}

/** Field names referenced anywhere in a condition tree. */
function fieldsIn(cond: Condition): string[] {
  if ('all' in cond) return cond.all.flatMap(fieldsIn);
  if ('any' in cond) return cond.any.flatMap(fieldsIn);
  if ('not' in cond) return fieldsIn(cond.not);
  if ('atLeast' in cond) return cond.of.flatMap(fieldsIn);
  if ('field' in cond) return [cond.field];
  return [];
}

/** Unanswered `askUser` prompts inside a condition tree. */
function questionsIn(cond: Condition, answers: Record<string, boolean>): string[] {
  if ('all' in cond) return cond.all.flatMap((c) => questionsIn(c, answers));
  if ('any' in cond) return cond.any.flatMap((c) => questionsIn(c, answers));
  if ('not' in cond) return questionsIn(cond.not, answers);
  if ('atLeast' in cond) return cond.of.flatMap((c) => questionsIn(c, answers));
  if ('askUser' in cond && answers[cond.askUser] === undefined) return [cond.askUser];
  return [];
}

// ---------------------------------------------------------------------------
// Dating
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const TERM_DAYS = 280;

export interface Dating {
  edd: Date;
  /** Gestational age today, in days. Negative before conception-by-dates. */
  currentGaDays: number;
  currentGaLabel: string;
}

export function computeDating(p: PatientProfile, today = new Date()): Dating | null {
  let edd: Date | null = null;
  if (p.edd) edd = new Date(p.edd);
  else if (p.lmp) edd = new Date(new Date(p.lmp).getTime() + TERM_DAYS * DAY);
  if (!edd || Number.isNaN(edd.getTime())) return null;

  const currentGaDays = Math.floor(
    TERM_DAYS - (edd.getTime() - today.getTime()) / DAY,
  );
  const w = Math.floor(currentGaDays / 7);
  const d = currentGaDays % 7;
  return {
    edd,
    currentGaDays,
    currentGaLabel: currentGaDays < 0 ? 'before dating' : `${w}w${d}d`,
  };
}

/** Calendar date at a given gestational age, for placing items on a timeline. */
export function dateAtGA(dating: Dating, ga: GA): Date {
  return new Date(dating.edd.getTime() - (TERM_DAYS - gaDays(ga)) * DAY);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanItem {
  ruleId: string;
  title: string;
  detail?: string;
  rationale: string;
  category: RuleCategory;
  timing: Timing;
  source: Source;
  tier?: RiskTier;

  /** Firing on an assumption rather than a confirmed input. */
  provisional: boolean;
  /** What the plan is assuming in the meantime. */
  assumption?: string;
  /** Unanswered prompts that would resolve this item. */
  openQuestions: string[];

  testing?: AntenatalTesting;
  delivery?: DeliveryRecommendation;
  pendingDecisions?: PendingDecision[];

  /** Set when another rule cancelled this one. Kept for display, not dropped. */
  suppressedBy?: { ruleId: string; title: string; rationale: string };

  /**
   * True when this item would appear for any pregnancy, false when it is here
   * because of something about this patient. Derived rather than hand-tagged:
   * see `standardRuleIds`. This is what the plan splits on.
   */
  standard: boolean;
}

export interface TierAssignment {
  tier: RiskTier;
  reasons: { ruleId: string; reason: string }[];
}

export interface DeliveryConflict {
  /** Every window that applies, in the order the rules produced them. */
  windows: { ruleId: string; title: string; delivery: DeliveryRecommendation }[];
  /** The earliest `latest` bound — the tightest constraint. Marked, not chosen. */
  tightestRuleId: string;
}

export interface ConsolidatedTesting {
  /** Earliest start across all applicable rules. */
  start: GA;
  /** Highest frequency across all applicable rules. */
  frequency: 'weekly' | 'twiceWeekly';
  /** Every rule that contributes, so the consolidation is auditable. */
  sources: { ruleId: string; title: string; testing: AntenatalTesting }[];
}

export interface Plan {
  dating: Dating | null;
  items: PlanItem[];
  suppressed: PlanItem[];
  /** Highest tier reached, with every contributing reason. */
  tier: TierAssignment;
  allTiers: TierAssignment[];
  testing: ConsolidatedTesting | null;
  deliveryConflict: DeliveryConflict | null;
  /** Applies only if a question is answered yes. Not scheduled. */
  conditional: PlanItem[];
  /** Distinct unanswered questions across the whole plan. */
  openQuestions: string[];
  /** Fields that appear in triggers but are unset, so could change the plan. */
  missingFields: string[];
  /** Set when care leaves family medicine entirely. */
  careTransferred: { ruleId: string; title: string } | null;
}

const TIER_ORDER: RiskTier[] = ['all', 'moderate', 'high', 'veryHigh'];

/**
 * The baseline plan: whatever fires for a patient with no risk factors
 * entered. Computed by running the triggers against an empty profile rather
 * than tagging rules by hand, so it cannot drift out of step with the data.
 * Provisional matches do not count — those are driven by unknowns, not by
 * being universal.
 */
const standardRuleIds = (rules: Rule[]): Set<string> =>
  new Set(
    rules.filter((r) => evaluate(r.trigger, {}, {}) === true).map((r) => r.id),
  );

let STANDARD_IDS: Set<string> | null = null;

export function generatePlan(
  profile: PatientProfile,
  answers: Record<string, boolean> = {},
  rules: Rule[] = RULES,
  today = new Date(),
): Plan {
  const standardIds =
    rules === RULES ? (STANDARD_IDS ??= standardRuleIds(RULES)) : standardRuleIds(rules);

  const fired: { rule: Rule; provisional: boolean }[] = [];

  for (const rule of rules) {
    const result = evaluate(rule.trigger, profile, answers);
    if (result === false) continue;
    fired.push({ rule, provisional: result === 'provisional' });
  }

  // Suppression. A suppressing rule only counts if it actually fired.
  const suppressors = new Map<string, Rule>();
  for (const { rule } of fired) {
    for (const target of rule.suppresses ?? []) suppressors.set(target, rule);
  }

  const items: PlanItem[] = [];
  const suppressed: PlanItem[] = [];
  const conditional: PlanItem[] = [];

  for (const { rule, provisional } of fired) {
    const item: PlanItem = {
      ruleId: rule.id,
      title: rule.title,
      detail: rule.detail,
      rationale: rule.rationale,
      category: rule.category,
      timing: rule.timing,
      source: rule.source,
      tier: rule.tier,
      provisional,
      assumption: rule.assumption,
      openQuestions: questionsIn(rule.trigger, answers),
      testing: rule.testing,
      delivery: rule.delivery,
      pendingDecisions: rule.pendingDecisions,
      standard: standardIds.has(rule.id),
    };

    // Provisional rules that opt out of being assumed are held back from the
    // schedule: putting them on the timeline would assert something we do not
    // know. They are listed as conditional instead.
    if (provisional && rule.assumeWhenUnresolved === false) {
      conditional.push(item);
      continue;
    }

    const by = suppressors.get(rule.id);
    if (by) {
      // Kept and shown struck through rather than dropped: a resident should
      // see that the usual step was deliberately removed, and why.
      suppressed.push({
        ...item,
        suppressedBy: { ruleId: by.id, title: by.title, rationale: by.rationale },
      });
    } else {
      items.push(item);
    }
  }

  // --- Risk tiers ---------------------------------------------------------
  const tierMap = new Map<RiskTier, { ruleId: string; reason: string }[]>();
  for (const { rule } of fired) {
    if (!rule.tier || !rule.tierReason) continue;
    const list = tierMap.get(rule.tier) ?? [];
    list.push({ ruleId: rule.id, reason: rule.tierReason });
    tierMap.set(rule.tier, list);
  }
  const allTiers: TierAssignment[] = TIER_ORDER.filter((t) => tierMap.has(t)).map(
    (t) => ({ tier: t, reasons: tierMap.get(t)! }),
  );
  const highest = allTiers.length ? allTiers[allTiers.length - 1] : { tier: 'all' as RiskTier, reasons: [] };

  // --- Antenatal testing consolidation ------------------------------------
  const testingRules = items.filter((i) => i.testing);
  let testing: ConsolidatedTesting | null = null;
  if (testingRules.length) {
    const start = testingRules.reduce<GA>(
      (earliest, i) => (gaDays(i.testing!.start) < gaDays(earliest) ? i.testing!.start : earliest),
      testingRules[0].testing!.start,
    );
    const frequency = testingRules.some((i) => i.testing!.frequency === 'twiceWeekly')
      ? 'twiceWeekly'
      : 'weekly';
    testing = {
      start,
      frequency,
      sources: testingRules.map((i) => ({
        ruleId: i.ruleId,
        title: i.title,
        testing: i.testing!,
      })),
    };
  }

  // --- Delivery conflicts --------------------------------------------------
  // Derived rather than hand-listed: any two rules carrying a delivery window
  // are in conflict by construction, so nothing needs maintaining in the data.
  const deliveryItems = items.filter((i) => i.delivery);
  let deliveryConflict: DeliveryConflict | null = null;
  if (deliveryItems.length) {
    const windows = deliveryItems.map((i) => ({
      ruleId: i.ruleId,
      title: i.title,
      delivery: i.delivery!,
    }));
    const bounded = windows.filter((w) => w.delivery.latest);
    const tightest = bounded.length
      ? bounded.reduce((a, b) =>
          gaDays(b.delivery.latest!) < gaDays(a.delivery.latest!) ? b : a,
        )
      : windows[0];
    deliveryConflict = { windows, tightestRuleId: tightest.ruleId };
  }

  // --- Open questions and missing information ------------------------------
  const openQuestions = [
    ...new Set([...items, ...conditional].flatMap((i) => i.openQuestions)),
  ];

  const referenced = new Set(rules.flatMap((r) => fieldsIn(r.trigger)));
  const missingFields = [...referenced].filter(
    (f) => (profile as Record<string, unknown>)[f] === undefined,
  );

  const transfer = fired.find((f) => f.rule.id === 'mfm-multiple-gestation');

  return {
    dating: computeDating(profile, today),
    items,
    suppressed,
    conditional,
    tier: highest,
    allTiers,
    testing,
    deliveryConflict,
    openQuestions,
    missingFields,
    careTransferred: transfer
      ? { ruleId: transfer.rule.id, title: transfer.rule.title }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Timeline placement
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  item: PlanItem;
  startWeek: number;
  endWeek: number;
  /** A point marker rather than a bar. */
  isPoint: boolean;
}

/** Items that sit at a definite gestational age, positioned for the timeline. */
export function toTimeline(items: PlanItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const item of items) {
    const t = item.timing;
    if (t.kind === 'atDiagnosis' || t.kind === 'everyVisit') continue;
    const startWeek = gaDays(t.start) / 7;
    const endWeek = 'end' in t && t.end ? gaDays(t.end) / 7 : startWeek;
    entries.push({
      item,
      startWeek,
      endWeek: Math.max(endWeek, startWeek),
      isPoint: t.kind === 'once' && endWeek - startWeek <= 1,
    });
  }
  return entries.sort((a, b) => a.startWeek - b.startWeek);
}

export { isTrue };
