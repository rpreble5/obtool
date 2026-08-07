/**
 * Type definitions for encoding the institutional OB protocol as data.
 *
 * Two design principles:
 *
 * 1. The protocol lives in data, never in application logic, so it can be
 *    updated and audited without touching code.
 * 2. Every rule carries reasoning. This is a teaching tool, so a plan item
 *    that appears without an explanation of *why* has failed at its job.
 */

// ---------------------------------------------------------------------------
// Gestational age
// ---------------------------------------------------------------------------

/**
 * Gestational age in obstetric convention: weeks + days, e.g. 39w6d.
 * Decimal weeks would lose the "6/7" precision the protocol uses for
 * delivery windows, so days are kept explicit.
 */
export interface GA {
  w: number;
  /** 0-6. Defaults to 0 when omitted. */
  d?: number;
}

export const gaDays = (g: GA): number => g.w * 7 + (g.d ?? 0);

export const gaFormat = (g: GA): string =>
  g.d ? `${g.w}w${g.d}d` : `${g.w} weeks`;

/** Always `39w0d`. Used wherever ages are compared or tabulated. */
export const gaShort = (g: GA): string => `${g.w}w${g.d ?? 0}d`;

// ---------------------------------------------------------------------------
// Trigger conditions
// ---------------------------------------------------------------------------

/**
 * A small boolean expression language over PatientProfile fields.
 *
 * `atLeast` exists specifically for the protocol's risk-counting rules
 * ("two moderate risk factors: nullip, BMI >30, ..."), which cannot be
 * expressed with plain and/or.
 */
export type Condition =
  | { always: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { atLeast: number; of: Condition[] }
  | { field: string; eq: string | number | boolean }
  | { field: string; gt: number }
  | { field: string; gte: number }
  | { field: string; lt: number }
  | { field: string; lte: number }
  | { field: string; in: (string | number)[] }
  /**
   * Criteria the protocol states but that cannot be evaluated from intake
   * data alone (e.g. "if poorly controlled"). The engine treats these as
   * *provisional* matches: the item appears on the plan immediately, marked
   * unresolved, rather than blocking plan generation behind a question.
   * See `Rule.assumption` for what the plan shows in the meantime.
   */
  | { askUser: string };

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type Timing =
  /** A one-off item due inside a window, e.g. GBS testing 35-36wks. */
  | { kind: 'once'; start: GA; end: GA; ideal?: GA }
  /** A continuous intervention over a span, e.g. ASA 12wks-36wks. */
  | { kind: 'span'; start: GA; end: GA }
  /** Repeating on an interval, e.g. PIH labs q3-4wks. */
  | { kind: 'recurring'; start: GA; end?: GA; interval: string }
  /** Fires as soon as the condition is known, not at a fixed GA. */
  | { kind: 'atDiagnosis' }
  /** Ongoing, assessed at each encounter. */
  | { kind: 'everyVisit' };

// ---------------------------------------------------------------------------
// Antenatal testing
// ---------------------------------------------------------------------------

/**
 * The protocol defines this vocabulary in its header:
 *   Weekly antenatal monitoring   = NST/MVP
 *   Biweekly antenatal monitoring = NST x2, MVP x1
 *
 * Note: the document uses "biweekly" to mean *twice weekly*, not
 * every-other-week. Encoded explicitly so the UI never has to guess.
 */
export type TestingFrequency = 'weekly' | 'twiceWeekly';

export interface AntenatalTesting {
  start: GA;
  frequency: TestingFrequency;
  /** Qualifies the start, e.g. "1-2 weeks before previous stillbirth". */
  startNote?: string;
}

export const testingModality = (f: TestingFrequency): string =>
  f === 'weekly' ? 'NST + MVP weekly' : 'NST x2 + MVP x1 weekly';

// ---------------------------------------------------------------------------
// Delivery planning
// ---------------------------------------------------------------------------

export type DeliveryAction =
  | 'offerIOL'
  | 'recommendIOL'
  | 'deliverBy'
  | 'scheduledCesarean'
  | 'counselOnly'
  | 'perMFM';

export interface DeliveryRecommendation {
  action: DeliveryAction;
  earliest?: GA;
  latest?: GA;
  /** Shown on the timeline bar so overlapping windows are self-explanatory. */
  indication: string;
  /** Set when timing is contingent on something the engine cannot compute. */
  caveat?: string;
}

// ---------------------------------------------------------------------------
// Decision points that resolve after intake
// ---------------------------------------------------------------------------

/**
 * Forks whose input doesn't exist at planning time ("if previa still present
 * on 36wk US..."). Rendered on the timeline as explicit pending decisions so
 * a resident planning at 20 weeks sees the fork coming, rather than the tool
 * asserting one branch.
 */
export interface PendingDecision {
  /** For forks tied to a gestational milestone, e.g. the 36wk ultrasound. */
  at?: GA;
  /** For forks tied to a result rather than a date, e.g. a reflex lab tree. */
  on?: string;
  question: string;
  branches: { condition: string; then: string }[];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface Source {
  /**
   * `protocol`         — traceable to the FMC document.
   * `standardGuidance` — not in the FMC document; added from established
   *                      practice to fill a gap. The UI must distinguish
   *                      these visibly so nothing added is mistaken for
   *                      institutional policy.
   */
  origin: 'protocol' | 'standardGuidance';
  /** Heading in the source document, e.g. "Chronic HTN". */
  section: string;
  /** Page in the source PDF. Absent for `standardGuidance` items. */
  page?: number;
  /** Paraphrased from the source — readable, not a verbatim quote. */
  text: string;
}

// ---------------------------------------------------------------------------
// Risk tier
// ---------------------------------------------------------------------------

/**
 * The document's organising spine. Tier determines care ownership, which is
 * arguably the single most useful output for a resident.
 */
export type RiskTier = 'all' | 'moderate' | 'high' | 'veryHigh';

export const tierAction: Record<RiskTier, string> = {
  all: 'Standard FM clinic care',
  moderate: 'Email / staff message HR OB group',
  high: 'Schedule into OB Fellow Clinic at least once per trimester',
  veryHigh: 'Refer to MFM',
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleCategory =
  | 'visit'
  | 'lab'
  | 'imaging'
  | 'immunization'
  | 'medication'
  | 'counseling'
  | 'referral'
  | 'monitoring'
  | 'delivery'
  | 'documentation';

export interface Rule {
  id: string;
  category: RuleCategory;
  /** Short label shown on the plan timeline. */
  title: string;
  /** Fuller instruction shown when the item is expanded. */
  detail?: string;

  /**
   * Why this recommendation exists — the teaching layer, in the resident's
   * language. Required: an item with no reasoning has failed at its job.
   */
  rationale: string;

  /** When this rule applies to a patient. */
  trigger: Condition;
  /** Risk tier this rule contributes, if any. */
  tier?: RiskTier;
  /** Why the patient lands in that tier, in plain language. */
  tierReason?: string;

  /**
   * What the plan assumes while an `askUser` trigger is unresolved, so the
   * plan is usable immediately and the question refines it rather than
   * gating it.
   */
  assumption?: string;
  /**
   * Whether an unresolved trigger should be assumed true and the item placed
   * on the plan. Defaults to true. Set false where assuming the condition
   * would put something on the plan that probably does not apply — those
   * items are listed separately as conditional rather than scheduled.
   */
  assumeWhenUnresolved?: boolean;

  timing: Timing;
  testing?: AntenatalTesting;
  delivery?: DeliveryRecommendation;
  pendingDecisions?: PendingDecision[];

  /**
   * Rules this one cancels. Required for negation rules such as bariatric
   * surgery removing the universal 1hr GTT — without this the plan would
   * print contradictory orders.
   */
  suppresses?: string[];

  source: Source;
}
