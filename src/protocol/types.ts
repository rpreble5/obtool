/**
 * Type definitions for encoding the institutional OB protocol as data.
 *
 * Design principle: the protocol lives in data, never in application logic.
 * Every rule carries the verbatim source text it came from, so the UI can
 * always show a resident *why* an item appeared and let them check it
 * against the original document.
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
   * Escape hatch for criteria the protocol states but that cannot be
   * evaluated from intake data alone (e.g. "if poorly controlled").
   * The engine treats these as *possible* matches and surfaces them to the
   * user as a question rather than silently firing or silently dropping.
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
  | { kind: 'everyVisit' }
  /** Postpartum rather than antepartum. */
  | { kind: 'postpartum'; note?: string };

// ---------------------------------------------------------------------------
// Antenatal testing
// ---------------------------------------------------------------------------

/**
 * The protocol defines this vocabulary in its header:
 *   Weekly antenatal monitoring   = NST/MVP
 *   Biweekly antenatal monitoring = NST x2, MVP x1
 *
 * Note: the document uses "biweekly" to mean *twice weekly*, not
 * every-other-week. Encoded explicitly so the UI can render it unambiguously.
 */
export type TestingFrequency = 'weekly' | 'twiceWeekly';

export interface AntenatalTesting {
  start: GA;
  frequency: TestingFrequency;
  /** Set when the protocol qualifies the start, e.g. "1-2 weeks before previous stillbirth". */
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
  /** Human-readable indication, shown on the timeline bar. */
  indication: string;
  /** Set when the protocol makes timing contingent on a factor we can't compute. */
  caveat?: string;
}

// ---------------------------------------------------------------------------
// Decision points that resolve after intake
// ---------------------------------------------------------------------------

/**
 * The protocol contains forks whose input doesn't exist at planning time
 * ("if previa still present on 36wk US..."). These are rendered on the
 * timeline as explicit pending decisions so a resident planning at 20 weeks
 * can see the fork coming, rather than the tool asserting one branch.
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
  /** Heading in the source document, e.g. "Chronic HTN". */
  section: string;
  page: number;
  /**
   * Verbatim text from the protocol, including its original typos.
   * Displayed to the resident so they can verify the encoding against the
   * source without leaving the app.
   */
  quote: string;
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

/**
 * A flag raised on a rule to communicate something about the *protocol
 * itself* rather than about the patient. These drive the "protocol gaps"
 * report — the artefact intended to support the case for updating guidance.
 */
export interface ProtocolNote {
  kind:
    | 'ambiguous' // protocol states something imprecisely
    | 'implicit' // protocol omits a condition that is clinically required
    | 'external' // protocol defers to a document we don't have
    | 'dated' // content may have been overtaken since the 2022/2023 edit
    | 'framing'; // wording matters and must be preserved in the UI
  note: string;
  /** Concrete suggested change, phrased for discussion with attendings. */
  proposedUpdate?: string;
}

export interface Rule {
  id: string;
  category: RuleCategory;
  /** Short label shown on the plan timeline. */
  title: string;
  /** Fuller instruction shown when the item is expanded. */
  detail?: string;

  /** When this rule applies to a patient. */
  trigger: Condition;
  /** Risk tier this rule contributes, if any. */
  tier?: RiskTier;
  /** Why the patient lands in that tier, in plain language. */
  tierReason?: string;

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
  /**
   * Rules that may recommend something different. Used to raise conflict
   * flags; the engine never resolves these silently.
   */
  conflictsWith?: string[];

  source: Source;
  protocolNotes?: ProtocolNote[];
}
