/**
 * =============================================================================
 * FMC OB PATIENT CARE — CLINICAL LOGIC
 * =============================================================================
 *
 * Self-contained. No imports, no dependencies, no UI. Drop into any
 * TypeScript project (or strip the types for plain JS).
 *
 * Source: "Family Medicine OB Patient Care", FMC OB Patient Care Update
 * 5_2022, header marked "Edit 4/23", 7 pages. 69 rules encoded.
 *
 * PROTOTYPE. NOT VALIDATED FOR CLINICAL USE.
 *
 * -----------------------------------------------------------------------------
 * WHAT IS IN HERE
 * -----------------------------------------------------------------------------
 *
 *   Types        GA as weeks+days, a small trigger language, timing, delivery
 *                windows, antenatal testing, provenance, risk tier.
 *   PatientProfile  Every input the rules can read, plus FIELD_INFO giving the
 *                clinical reason each input is asked for.
 *   RULES        The protocol as 69 data records. Each carries a required
 *                `rationale` (why the recommendation exists) and a `source`
 *                (section + page, paraphrased not quoted).
 *   Engine       generatePlan(profile) -> risk tier, scheduled items, delivery
 *                conflicts, consolidated antenatal testing, buckets, and the
 *                input-to-item attribution map.
 *
 * -----------------------------------------------------------------------------
 * QUICK START
 * -----------------------------------------------------------------------------
 *
 *   const plan = generatePlan({
 *     lmp: '2026-01-05',
 *     ageAtDelivery: 41,
 *     bmiAtIntake: 42,
 *     chronicHypertension: true,
 *     bpControl: 'controlledOnMeds',
 *     gdm: true, gdmClass: 'A2',
 *     priorCesarean: true,
 *     placentaPrevia: true,
 *   });
 *
 *   plan.tier              // highest risk tier + every contributing reason
 *   plan.items             // scheduled care, each with bucket + causedBy
 *   plan.suppressed        // items another rule cancelled, with the reason
 *   plan.deliveryConflict  // all applicable windows; tightest marked, never chosen
 *   plan.testing           // earliest start + highest frequency, with sources
 *   plan.conditional       // applies only if a question is answered yes
 *   plan.openQuestions     // unresolved, but nothing is blocked on them
 *
 * -----------------------------------------------------------------------------
 * DESIGN DECISIONS WORTH KEEPING
 * -----------------------------------------------------------------------------
 *
 * 1. CONFLICTS ARE SURFACED, NEVER RESOLVED. A patient can trip four delivery
 *    windows that disagree. All are returned with their indications; the
 *    tightest is marked. Picking one silently would hide the reasoning a
 *    resident is supposed to be learning.
 *
 * 2. SUPPRESSED ITEMS ARE KEPT, NOT DROPPED. Bariatric surgery removes the
 *    universal 1hr GTT. The GTT stays in `plan.suppressed` with the reason, so
 *    a removed step is visible rather than mysteriously absent.
 *
 * 3. NOTHING BLOCKS ON A QUESTION. Triggers that cannot be evaluated from
 *    intake data render provisionally on a stated `assumption`. Rules that set
 *    `assumeWhenUnresolved: false` go to `plan.conditional` instead, because
 *    assuming them would schedule care that probably does not apply.
 *
 * 4. ADDITIONS ARE MARKED. Anything not traceable to the FMC document has
 *    `source.origin: 'standardGuidance'` — currently only the routine visit
 *    cadence, which the document never states. Never let these be mistaken
 *    for institutional policy.
 *
 * 5. STANDARD VS ADDITIONAL IS DERIVED. `item.standard` is computed by running
 *    the triggers against an empty profile. 18 items are baseline for any
 *    pregnancy. Not hand-tagged, so it cannot drift from the data.
 *
 * -----------------------------------------------------------------------------
 * DELIBERATE DEVIATIONS FROM THE SOURCE DOCUMENT
 * -----------------------------------------------------------------------------
 *
 * - anti-d-28wk is gated on `rhNegative`. The document lists it under "All
 *   patients" with no condition stated, but anti-D applies only to Rh-negative
 *   patients. Encoding it literally would be wrong.
 *
 * - accreta-risk covers all previa, and prior caesarean with anterior placenta.
 *   An earlier encoding required previa AND prior caesarean together; the
 *   document's very-high-risk list is broader.
 *
 * - chronic-htn is split into three rules by `bpControl`, because testing
 *   frequency and delivery window both depend on it.
 *
 * -----------------------------------------------------------------------------
 * KNOWN GAPS — WORTH RAISING WITH ATTENDINGS
 * -----------------------------------------------------------------------------
 *
 * - Gestational hypertension / pre-eclampsia is deferred by the document to a
 *   "clinic flowsheet" that was never supplied. A major condition is therefore
 *   NOT encoded. See rule `ghtn-preeclampsia`.
 *
 * - The document states no routine visit cadence. The q4/q2/weekly schedule
 *   here is conventional practice, marked `standardGuidance`.
 *
 * - The document is dated 2022, last edited 4/23. Some content (COVID guidance,
 *   the clinic-wide aspirin stance) may have been overtaken.
 *
 * - Four inputs cannot change the plan alone: nulliparous, family history of
 *   pre-eclampsia, and interpregnancy interval >10yr are each ONE of the two
 *   moderate aspirin factors required; tobacco has no rule at all, appearing
 *   only as prose about preterm recurrence risk. Any UI must show partial
 *   contribution or these read as dead controls.
 *
 * - `bucket` (overdue / now / future) has two limits. Nine items sit in "now"
 *   at every gestational age because they are standing states, not tasks, and
 *   can never be completed. And "overdue" reaches 24 items by 37 weeks because
 *   completion is not tracked — it needs either a "care established at" input
 *   or per-item check-off before it is trustworthy.
 *
 * =============================================================================
 */

// ==========================================================================
// FROM types.ts
// ==========================================================================

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


// ==========================================================================
// FROM patient.ts
// ==========================================================================

/**
 * The patient inputs a resident supplies. Field names here are the strings
 * referenced by `Condition.field` in the rules data.
 *
 * Everything is optional: the plan is generated from whatever is known so
 * far, and unknown fields that would have changed the plan are surfaced as
 * "missing information" rather than silently assumed.
 */

export interface PatientProfile {
  // --- Dating -------------------------------------------------------------
  lmp?: string;
  edd?: string;
  datingConfirmedByUS?: boolean;

  // --- Demographics -------------------------------------------------------
  /** Age at expected time of delivery, which is what the protocol keys on. */
  ageAtDelivery?: number;
  bmiAtIntake?: number;
  blackRace?: boolean;
  lowerIncome?: boolean;

  // --- Obstetric history --------------------------------------------------
  gravidity?: number;
  parity?: number;
  nulliparous?: boolean;
  priorPreeclampsia?: boolean;
  priorGestationalHTN?: boolean;
  priorCesarean?: boolean;
  interpregnancyIntervalYears?: number;
  familyHxPreeclampsia?: boolean;

  priorPretermDelivery?: boolean;
  pretermDeliveryType?: 'medicallyIndicated' | 'spontaneous' | 'cervicalIncompetence';
  multiplePriorPretermBefore35?: boolean;
  tobaccoUse?: boolean;

  priorFetalDemiseAfter20wks?: boolean;
  gaOfPriorDemiseWeeks?: number;

  // --- Current pregnancy --------------------------------------------------
  plurality?: 'singleton' | 'multiple';
  presentation?: 'vertex' | 'breech' | 'other' | 'unknown';
  placentaPrevia?: boolean;
  anteriorPlacenta?: boolean;
  cervicalLengthMm?: number;
  fundalHeightDiscrepancyCm?: number;
  efwPercentile?: number;

  // --- Medical history ----------------------------------------------------
  chronicHypertension?: boolean;
  bpControl?: 'controlledOffMeds' | 'controlledOnMeds' | 'uncontrolledOnMeds';

  pregestationalDiabetes?: boolean;
  diabetesType?: 'type1' | 'type2';
  gdm?: boolean;
  gdmClass?: 'A1' | 'A2';
  gdmWellControlled?: boolean;

  hypothyroid?: boolean;
  priorHxHypothyroid?: boolean;
  hyperthyroid?: boolean;

  renalDisease?: boolean;
  autoimmuneDisease?: boolean;
  seizureDisorder?: boolean;
  clottingDisorder?: boolean;
  activeDvtOrPe?: boolean;
  heartDisease?: boolean;
  lungDisease?: boolean;
  chronicHepatitis?: boolean;
  activeSyphilis?: boolean;
  tuberculosis?: boolean;
  hiv?: boolean;
  positiveAntibodyScreen?: boolean;

  bariatricSurgery?: boolean;
  genitalHSV?: boolean;
  cholestasis?: boolean;
  bileAcidLevel?: number;
  activeDepressionOrAnxietyOnMeds?: boolean;
  covidInfectionThisPregnancy?: boolean;
  gaAtCovidInfectionWeeks?: number;
  recurrentPositiveUrineCulture?: boolean;
  pyelonephritisThisPregnancy?: boolean;

  /** Rh status drives the 28wk anti-D immune globulin rule. */
  rhNegative?: boolean;

  // --- Social -------------------------------------------------------------
  teenFirstPregnancy?: boolean;
  lowSES?: boolean;
}

/**
 * The teaching layer for inputs.
 *
 * Every field a resident can set carries an explanation of *why it is being
 * asked* — visible at the moment of entry, not only after the plan renders.
 * The goal is that filling in the intake form is itself instructive.
 */
export interface FieldInfo {
  label: string;
  /** What this input changes about the plan, and why that is the case. */
  why: string;
  /**
   * Context that must be displayed inline with the field rather than hidden
   * behind a tooltip, because the label alone would be misleading.
   */
  framing?: string;
}

export const FIELD_INFO: Partial<Record<keyof PatientProfile, FieldInfo>> = {
  ageAtDelivery: {
    label: 'Age at expected delivery',
    why: 'Drives the advanced maternal age pathway. The protocol keys on age at delivery rather than age at intake, and splits at 35 and 40 — the 40+ pathway adds MFM referral, weekly testing from 36wks, and a growth scan at 28-32wks.',
  },
  bmiAtIntake: {
    label: 'BMI at onset of prenatal care',
    why: 'Sets weight-gain targets, adds A1c to the initial labs above 30, and determines when antenatal testing starts: weekly from 36wks at BMI 35-39.9, and from 34wks at BMI 40 or above. Also counts as a moderate aspirin risk factor above 30.',
  },
  blackRace: {
    label: 'Black race',
    why: 'Counts on its own as a moderate risk factor meeting aspirin criteria, and raises the recurrence risk estimate after a prior spontaneous preterm birth.',
    framing:
      'The protocol lists this because of underlying social inequity and exposure to systemic racism — not biologic propensity. It is a proxy for unequal care and access, not an inherent difference.',
  },
  lowerIncome: {
    label: 'Lower income',
    why: 'Counts on its own as a moderate risk factor meeting aspirin criteria. Combined with a first pregnancy in a teenager, it also triggers Nurse Family Partnership referral.',
  },
  nulliparous: {
    label: 'Nulliparous',
    why: 'One of the moderate aspirin risk factors — two are needed to meet criteria on their own. Also one of the additional factors that moves a 38-39 year old into the 40+ management pathway.',
  },
  interpregnancyIntervalYears: {
    label: 'Years since last delivery',
    why: 'An interval over 10 years counts as a moderate aspirin risk factor. A short interval raises recurrence risk after a prior spontaneous preterm birth.',
  },
  priorPreeclampsia: {
    label: 'Prior pre-eclampsia',
    why: 'A high-risk factor that meets aspirin criteria on its own, and adds baseline pre-eclampsia labs (CBC, CMP, urine protein:creatinine) at the first visit.',
  },
  priorPretermDelivery: {
    label: 'Prior preterm delivery',
    why: 'What follows depends entirely on the cause, so the next question matters more than this one: medically indicated births need no intervention, cervical incompetence needs first-trimester MFM referral for cerclage, and spontaneous preterm birth opens cervical length screening and vaginal progesterone.',
  },
  pretermDeliveryType: {
    label: 'Cause of the prior preterm delivery',
    why: 'The three causes lead to three completely different plans. Getting this wrong produces either unnecessary intervention or a missed cerclage window.',
  },
  priorCesarean: {
    label: 'Prior cesarean',
    why: 'Requires documenting scar type and indication, second-trimester TOLAC counselling with the OB fellow, and follow-up with a caesarean-capable provider after 36wks. With an anterior placenta or previa it also raises accreta risk, which is an MFM referral.',
  },
  priorFetalDemiseAfter20wks: {
    label: 'Prior fetal demise after 20 weeks',
    why: 'Adds early A1c, genetic screening, a 32wk growth scan, and delivery offered at 39wks. If the prior loss was after 34wks, antenatal testing starts 1-2 weeks before the gestational age at which it occurred.',
  },
  plurality: {
    label: 'Singleton or multiple',
    why: 'Multiple gestation is a very-high-risk condition: MFM referral, then care transfers out of family medicine entirely. It also meets aspirin criteria on its own.',
  },
  placentaPrevia: {
    label: 'Placenta previa',
    why: 'Triggers pelvic rest, no digital exams, L&D precautions for bleeding, and serial ultrasounds at 32 and 36wks. If it persists at 36wks, delivery becomes a scheduled caesarean at 36-37w6d. With a prior caesarean it also raises accreta risk.',
  },
  chronicHypertension: {
    label: 'Chronic hypertension',
    why: 'Defined as BP over 140/90 on two occasions more than 3 hours apart before 20wks. Requires stopping ACE inhibitors, ARBs, diuretics and statins, baseline and 3-4 weekly pre-eclampsia labs, and sets a delivery window that varies with control.',
  },
  bpControl: {
    label: 'Blood pressure control',
    why: 'Determines both whether antenatal testing is needed and how early delivery is recommended. Controlled off medication needs no testing; controlled on medication starts weekly at 32wks; uncontrolled on medication starts twice weekly at 32wks.',
  },
  gdmClass: {
    label: 'GDM class',
    why: 'A1 (diet controlled) needs one growth scan at 32wks, no antenatal testing, and delivery before 40w6d. A2 (medication controlled) needs monthly growth scans, weekly testing from 32wks, and delivery at 39w0d-39w6d.',
  },
  pregestationalDiabetes: {
    label: 'Pre-existing diabetes',
    why: 'Distinct from gestational diabetes and considerably more intensive: twice-weekly testing from 32wks, MFM referral for anatomy scan and fetal echocardiogram at 20wks, and growth scans every 4 weeks. ACE inhibitors are stopped and oral agents converted to insulin.',
  },
  bariatricSurgery: {
    label: 'History of bariatric surgery',
    why: 'Replaces the standard glucose tolerance test with two weeks of home glucose monitoring, since the GTT is poorly tolerated and unreliable after bariatric surgery. Also adds micronutrient monitoring and a 32wk growth scan.',
  },
  cholestasis: {
    label: 'Cholestasis of pregnancy',
    why: 'Suspected with itching of the palms and soles, especially at night. Bile acid level then sets delivery timing, so the number matters as much as the diagnosis.',
  },
  bileAcidLevel: {
    label: 'Total bile acid level',
    why: 'The threshold is 100. Above it, delivery at 36wks with steroids and an MFM discussion; below it, delivery between 36 and 39wks. Labs can lag symptoms by up to 3 weeks, so a normal early result does not exclude the diagnosis.',
  },
  rhNegative: {
    label: 'Rh negative',
    why: 'Determines whether anti-D immune globulin is given at 28wks with a repeat antibody screen.',
  },
  hypothyroid: {
    label: 'Hypothyroidism',
    why: 'The pregnancy TSH target is below 2.5, lower than the non-pregnant target. Patients already on replacement are advised to increase their dose by about 30% at conception — practically, doubling the daily dose on two days each week.',
  },
  genitalHSV: {
    label: 'History of genital HSV',
    why: 'Adds suppression with acyclovir from 36wks. Active lesions at the time of delivery mean caesarean.',
  },
  teenFirstPregnancy: {
    label: 'First pregnancy in a teenager',
    why: 'Triggers Nurse Family Partnership referral, as does low socioeconomic status.',
  },
};


// ==========================================================================
// FROM rules.ts
// ==========================================================================

/**
 * The FMC OB protocol encoded as rules.
 *
 * Source: "Family Medicine OB Patient Care", FMC OB Patient Care Update
 * 5_2022, header marked "Edit 4/23", 7 pages.
 *
 * Source text is paraphrased for readability rather than quoted verbatim,
 * but nothing is added to the clinical content. Where an item is *not* from
 * the FMC document, `source.origin` is `standardGuidance` so the UI can mark
 * it visibly — nothing added should be mistaken for institutional policy.
 *
 * Conflicting delivery windows are derived by the engine from any rules
 * carrying a `delivery` field, rather than being listed by hand on each rule.
 */

export const PROTOCOL_META = {
  title: 'Family Medicine OB Patient Care',
  documentTitle: 'FMC OB Patient Care Update 5_2022',
  edit: '4/23',
  pages: 7,
  currencyWarning:
    'This protocol was authored in 2022 and last edited 4/23. Some content may have been overtaken by subsequent guidance. Verify against current practice before clinical use.',
  /** Header definitions the whole document depends on. */
  glossary: {
    'Weekly antenatal monitoring': 'NST + MVP',
    'Biweekly antenatal monitoring': 'NST x2 + MVP x1 — twice weekly, not every other week',
    MVP: 'Maximum vertical pocket',
  },
};

export const RULES: Rule[] = [
  // =========================================================================
  // ALL PATIENTS — visit structure
  // =========================================================================
  {
    id: 'visit-cadence-early',
    category: 'visit',
    title: 'Routine visits every 4 weeks',
    rationale:
      'The standard antenatal schedule. Visits are spaced widely early because the main purposes — dating, screening, and establishing risk — are milestone-driven rather than surveillance-driven.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'recurring', start: { w: 8 }, end: { w: 28 }, interval: 'every 4 weeks' },
    source: {
      origin: 'standardGuidance',
      section: 'Baseline visit schedule',
      text: 'The FMC document specifies milestone items but never states a routine visit cadence. This is the conventional schedule, added to fill that gap.',
    },
  },
  {
    id: 'visit-cadence-mid',
    category: 'visit',
    title: 'Routine visits every 2 weeks',
    rationale:
      'Frequency increases in the third trimester as the yield of surveillance rises — blood pressure, growth, and fetal movement all become more informative.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'recurring', start: { w: 28 }, end: { w: 36 }, interval: 'every 2 weeks' },
    source: {
      origin: 'standardGuidance',
      section: 'Baseline visit schedule',
      text: 'Not stated in the FMC document. Conventional schedule.',
    },
  },
  {
    id: 'visit-cadence-late',
    category: 'visit',
    title: 'Routine visits weekly',
    rationale:
      'Weekly review from 36wks to delivery, when pre-eclampsia risk peaks and presentation and delivery planning need confirming.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'recurring', start: { w: 36 }, interval: 'weekly until delivery' },
    source: {
      origin: 'standardGuidance',
      section: 'Baseline visit schedule',
      text: 'Not stated in the FMC document. Conventional schedule.',
    },
  },

  // =========================================================================
  // ALL PATIENTS — first visit
  // =========================================================================
  {
    id: 'confirm-pregnancy',
    category: 'lab',
    title: 'Confirm pregnancy and establish dating',
    detail:
      'Urine pregnancy test if not already done. If dating is unknown, check fundal height and perform bedside ultrasound.',
    rationale:
      'Dating is the foundation the entire plan rests on — every subsequent window, from aspirin at 12wks to GBS at 35-36wks, is calculated from it. An error here propagates through the whole pregnancy.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Confirm pregnancy with UPT if not already done. If dating is unknown, check fundal height and do a bedside ultrasound.',
    },
  },
  {
    id: 'prenatal-lab-panel',
    category: 'lab',
    title: 'Prenatal lab panel',
    detail:
      'ABO, Rh, antibody screen, CBC, Rubella IgG, HIV, RPR, Hep B surface antigen, Varicella, TSH, Hep C antibody, GC/Chlamydia, urine culture. Epic order: "prenatal lab panel".',
    rationale:
      'A single bundled order covering blood type and alloimmunisation risk, infectious screening that changes management if positive, and baseline haematology and thyroid function. Several results feed directly into later rules — Rh status determines the 28wk anti-D, and TSH opens the thyroid pathway.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 }, ideal: { w: 8 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Order the prenatal lab panel: ABO, Rh, antibody screen, CBC, Rubella IgG, HIV, RPR, Hep B surface antigen, Varicella, TSH, Hep C antibody, GC/Chlamydia and urine culture.',
    },
  },
  {
    id: 'carrier-screening',
    category: 'lab',
    title: 'Preparent carrier screening',
    detail:
      'Society-guided panel (SMA, CF, fragile X, haemoglobinopathy, sickle cell) as the default. Core panel (SMA, CF, fragile X) if haemoglobinopathy and sickle cell screening are not needed.',
    rationale:
      'Recommended once per lifetime rather than once per pregnancy, so check whether it has already been done before reordering.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Preparent screening is recommended once per lifetime. Use the society-guided panel by default, or the core panel where haemoglobinopathy and sickle cell screening are not required.',
    },
  },
  {
    id: 'weight-gain-counseling',
    category: 'counseling',
    title: 'Weight gain recommendations',
    detail:
      'BMI <18.5: 28-40 lbs. BMI 18.5-24.9: 25-35 lbs. BMI 25.0-29.9: 15-25 lbs. BMI >30: 11-20 lbs.',
    rationale:
      'Targets are set by starting BMI, so this is a first-visit conversation — the recommendation cannot be applied retrospectively once gain has already occurred.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Weight gain targets by BMI: under 18.5, 28-40 lbs; 18.5-24.9, 25-35 lbs; 25.0-29.9, 15-25 lbs; over 30, 11-20 lbs.',
    },
  },
  {
    id: 'pap-if-indicated',
    category: 'lab',
    title: 'Pap smear if indicated',
    rationale:
      'Pregnancy is an opportunity to catch up routine cervical screening, but only if it is actually due — this is not a universal order.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Perform a Pap if indicated.',
    },
  },

  // =========================================================================
  // ALL PATIENTS — immunisations
  // =========================================================================
  {
    id: 'flu-vaccine',
    category: 'immunization',
    title: 'Influenza vaccine',
    rationale:
      'Can be given at any point in pregnancy once seasonal supply is available, so there is no window to miss — but it does need to be actively offered rather than deferred.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 42 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'Influenza vaccine at any time during pregnancy once available.',
    },
  },
  {
    id: 'covid-vaccine',
    category: 'immunization',
    title: 'COVID-19 vaccine',
    rationale:
      'Vaccination and boosters are safe and recommended in pregnancy. The protocol states this in strong terms.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 42 } },
    source: {
      origin: 'protocol',
      section: 'All patients — First Visit',
      page: 1,
      text: 'COVID vaccine is strongly recommended.',
    },
  },
  {
    id: 'tdap',
    category: 'immunization',
    title: 'Tdap',
    rationale:
      'Given in this window regardless of prior Tdap history, because the point is transplacental antibody transfer to protect the newborn from pertussis before their own immunisations begin.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 27 }, end: { w: 36 } },
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: 'Tdap between 27 and 36 weeks.',
    },
  },

  // =========================================================================
  // ALL PATIENTS — aspirin
  // =========================================================================
  {
    id: 'asa-prophylaxis',
    category: 'medication',
    title: 'Aspirin 81 mg daily',
    detail: 'Start at 12wks, continue through 36wks.',
    rationale:
      'The clinic has moved to recommending aspirin for every patient rather than only those meeting risk criteria, on the reasoning that the benefit in reducing pre-eclampsia outweighs the low risk and that criteria-based selection misses cases. A truly low-risk patient may opt out after discussion.',
    // Encoded as universal because the clinic-wide default does not depend on
    // risk factors. The risk criteria are a separate rule so a resident sees
    // both the policy and whether this patient independently meets criteria.
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'span', start: { w: 12 }, end: { w: 36 } },
    source: {
      origin: 'protocol',
      section: 'All patients — 8-12wks',
      page: 1,
      text: 'Discuss starting aspirin 81 mg from 12wks through 36wks. Aspirin is now recommended for all patients in the clinic; individual patients who are truly low risk may opt out after discussion.',
    },
  },
  {
    id: 'asa-risk-factors',
    category: 'counseling',
    title: 'Meets independent aspirin criteria',
    rationale:
      'This patient would meet aspirin criteria on risk factors alone, independent of the clinic-wide default. That strengthens the recommendation and is worth saying explicitly if the patient is considering opting out.',
    trigger: {
      any: [
        // One high-risk factor is sufficient
        {
          any: [
            { field: 'priorPreeclampsia', eq: true },
            { field: 'priorGestationalHTN', eq: true },
            { field: 'plurality', eq: 'multiple' },
            { field: 'chronicHypertension', eq: true },
            { field: 'pregestationalDiabetes', eq: true },
            { field: 'renalDisease', eq: true },
            { field: 'autoimmuneDisease', eq: true },
          ],
        },
        // Either of these two moderate factors is sufficient on its own
        {
          any: [
            { field: 'lowerIncome', eq: true },
            { field: 'blackRace', eq: true },
          ],
        },
        // Any two of these moderate factors
        {
          atLeast: 2,
          of: [
            { field: 'nulliparous', eq: true },
            { field: 'bmiAtIntake', gt: 30 },
            { field: 'familyHxPreeclampsia', eq: true },
            { field: 'ageAtDelivery', gte: 35 },
            { field: 'interpregnancyIntervalYears', gt: 10 },
          ],
        },
      ],
    },
    timing: { kind: 'once', start: { w: 8 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — 8-12wks',
      page: 1,
      text: 'Aspirin criteria are met by any one high-risk factor (prior pre-eclampsia, gestational hypertension, twins, chronic hypertension, pre-existing diabetes, renal disease, autoimmune disease); by lower income or Black race alone, which the protocol attributes to underlying social inequity rather than biologic propensity; or by any two of nulliparity, BMI over 30, family history of pre-eclampsia, advanced maternal age, or an interpregnancy interval over 10 years.',
    },
  },

  // =========================================================================
  // ALL PATIENTS — imaging and screening milestones
  // =========================================================================
  {
    id: 'dating-ultrasound',
    category: 'imaging',
    title: 'Dating ultrasound',
    detail:
      'Scheduled into OB Fellow Clinic or with Harrington, Gayer, or Ochs. If no availability, ordering through radiology is acceptable.',
    rationale:
      'Dating accuracy is highest in the first trimester and degrades steadily after it, so this window matters. The established EDD then governs every later decision — including growth scan interpretation, where using the wrong EDD produces a spurious growth abnormality.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 8 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'All patients — 8-12wks',
      page: 1,
      text: 'Dating ultrasound at 8-12wks, scheduled into OB Fellow Clinic or with Harrington, Gayer or Ochs; radiology is acceptable if there is no availability.',
    },
  },
  {
    id: 'genetic-screening',
    category: 'lab',
    title: 'Offer genetic screening',
    detail:
      'Quad screen at 15-20wks for low risk. Cell-free DNA any time after 10wks for high risk — age over 35, history of genetic abnormality, abnormal quad screen, or abnormal anatomy scan. If cfDNA is collected, draw AFP at 15-20wks.',
    rationale:
      'Two different pathways depending on risk. The AFP addition matters: cfDNA screens for aneuploidy but not neural tube defects, so it does not replace the AFP that the quad screen would have included. The protocol is explicit that cfDNA should not be ordered for sex determination.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 10 }, end: { w: 20 } },
    pendingDecisions: [
      {
        on: 'Genetic screening risk category',
        question: 'Which screening pathway applies?',
        branches: [
          { condition: 'Low risk', then: 'Quad screen at 15-20wks' },
          {
            condition: 'High risk — age over 35, prior genetic abnormality, abnormal quad, or abnormal anatomy scan',
            then: 'cfDNA any time after 10wks, plus AFP at 15-20wks',
          },
        ],
      },
    ],
    source: {
      origin: 'protocol',
      section: 'All patients — 8-12wks',
      page: 1,
      text: 'Offer genetic testing: quad screen at 15-20wks for low risk, or cfDNA after 10wks for high risk. Draw AFP at 15-20wks if cfDNA was collected. Do not offer cfDNA solely for sex determination.',
    },
  },
  {
    id: 'anatomy-scan',
    category: 'imaging',
    title: 'Anatomy scan',
    detail: 'Order through the ultrasound department — not performed at FMC. Order as "US OB >14wks".',
    rationale:
      'The main structural survey of the pregnancy. It also incidentally reports cervical length and placental position, either of which can open a new pathway, so the report needs reading in full rather than just checking the summary line.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 18 }, end: { w: 22 } },
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: 'Anatomy scan at 18-22wks, ordered through the ultrasound department rather than performed at FMC.',
    },
  },
  {
    id: 'gtt-1hr-routine',
    category: 'lab',
    title: '1 hr GTT and H/H',
    rationale:
      'Universal screening for gestational diabetes, paired with a haemoglobin check at the point where physiologic anaemia is most pronounced.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 26 }, end: { w: 28 } },
    pendingDecisions: [
      {
        on: '1 hr GTT result',
        question: 'How should the 1 hr GTT be interpreted?',
        branches: [
          { condition: 'Under 135', then: 'Normal — no further testing' },
          { condition: '135 to 200', then: 'Proceed to 3 hr GTT; two or more abnormal values (95/180/155/140) confirm GDM' },
          { condition: 'Over 200', then: 'Diagnostic of GDM — a 3 hr GTT is not needed' },
        ],
      },
    ],
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: '1 hr GTT and H/H at 26-28wks.',
    },
  },
  {
    id: 'anti-d-28wk',
    category: 'medication',
    title: 'Anti-D immune globulin (Rhogam) and repeat antibody screen',
    rationale:
      'Prevents alloimmunisation in Rh-negative patients before third-trimester sensitising events. Note that the protocol lists this under "all patients" without stating the condition — it applies only to Rh-negative patients, so this rule is gated on Rh status rather than encoded literally.',
    trigger: { field: 'rhNegative', eq: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 28 }, end: { w: 28, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: 'Rhogam with a repeat antibody screen at 28wks.',
    },
  },
  {
    id: 'gbs-testing',
    category: 'lab',
    title: 'GBS testing',
    rationale:
      'Timed late enough that the result still reflects colonisation status at delivery, but early enough to be available if labour starts at term.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 35 }, end: { w: 36 } },
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: 'GBS testing at 35-36wks.',
    },
  },
  {
    id: 'us-36wk-position',
    category: 'imaging',
    title: '36 week ultrasound — presentation and fluid',
    detail: 'Confirm vertex position and assess amniotic fluid by maximum vertical pocket.',
    rationale:
      'The last routine opportunity to identify malpresentation while external cephalic version is still an option. A breech finding here opens a time-sensitive pathway.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 36 }, end: { w: 36, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'All patients',
      page: 2,
      text: 'Ultrasound at 36wks for vertex position and amniotic fluid assessment by MVP.',
    },
  },

  // =========================================================================
  // ALL PATIENTS — other considerations
  // =========================================================================
  {
    id: 'nfp-referral',
    category: 'referral',
    title: 'Nurse Family Partnership referral',
    rationale:
      'A home visiting programme for first-time young parents and families with limited resources. Referred early because the programme is designed to run through pregnancy and into the child\'s first years.',
    trigger: {
      any: [{ field: 'teenFirstPregnancy', eq: true }, { field: 'lowSES', eq: true }],
    },
    tier: 'all',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'Other considerations',
      page: 2,
      text: 'Refer first pregnancy in a teenager, or low SES, to Nurse Family Partnership via the order link.',
    },
  },
  {
    id: 'hsv-suppression',
    category: 'medication',
    title: 'HSV suppression from 36 weeks',
    detail: 'Acyclovir 400 mg three times daily from 36wks.',
    rationale:
      'Suppression reduces the chance of an active lesion at delivery, which matters because active lesions mean caesarean — so this is an intervention aimed at preserving the option of vaginal birth.',
    trigger: { field: 'genitalHSV', eq: true },
    tier: 'all',
    timing: { kind: 'span', start: { w: 36 }, end: { w: 42 } },
    pendingDecisions: [
      {
        at: { w: 40 },
        question: 'Are active lesions present at the time of delivery?',
        branches: [
          { condition: 'No active lesions', then: 'Vaginal delivery may proceed' },
          { condition: 'Active lesions present', then: 'Caesarean section' },
        ],
      },
    ],
    source: {
      origin: 'protocol',
      section: 'Other considerations',
      page: 2,
      text: 'History of genital HSV: suppression with acyclovir 400 mg TID from 36wks. Caesarean if active lesions are present at the time of delivery.',
    },
  },

  // =========================================================================
  // MODERATE RISK — email / staff message HR OB group
  // =========================================================================
  {
    id: 'ama-35-39',
    category: 'monitoring',
    title: 'Advanced maternal age 35-39',
    detail:
      'Offer cfDNA. Counsel on increased risk of trisomy, pre-eclampsia, gestational diabetes and preterm delivery. Low threshold for a growth scan if size is less than dates.',
    rationale:
      'Age-related risk rises continuously rather than stepping at a threshold, which is why the protocol allows a 38-39 year old with additional risk factors to be managed as if they were over 40. Delivery is offered at 39wks because stillbirth risk begins to rise while the benefit of further expectant management does not.',
    trigger: {
      all: [
        { field: 'ageAtDelivery', gte: 35 },
        { field: 'ageAtDelivery', lt: 40 },
      ],
    },
    tier: 'moderate',
    tierReason: 'Advanced maternal age (35-39 at delivery)',
    timing: { kind: 'atDiagnosis' },
    delivery: {
      action: 'offerIOL',
      earliest: { w: 39 },
      latest: { w: 41 },
      indication: 'Advanced maternal age 35-39',
      caveat:
        'Offer IOL at 39wks, or twice-weekly NST from 39wks with delivery by 41wks. If 38-39 with obesity, nulliparity, or Black race, consider managing as age over 40.',
    },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — AMA',
      page: 2,
      text: 'Age 35-39 at delivery: offer cfDNA and counsel on increased risk. Low threshold for growth scan if size is less than dates. Offer induction at 39wks or twice-weekly NST from 39wks, with delivery by 41wks. Consider managing as over 40 if 38-39 with additional risk factors.',
    },
  },
  {
    id: 'ama-over-40',
    category: 'monitoring',
    title: 'Advanced maternal age 40 or over',
    detail: 'Send for a visit in fellow clinic. Offer MFM referral.',
    rationale:
      'The protocol reasons that stillbirth risk at 39wks in a patient over 40 is comparable to that at 41wks in a younger patient — so induction at 39wks restores an equivalent risk profile rather than intervening early.',
    trigger: { field: 'ageAtDelivery', gte: 40 },
    tier: 'moderate',
    tierReason: 'Advanced maternal age (40 or over at delivery)',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 36 }, frequency: 'weekly' },
    delivery: {
      action: 'offerIOL',
      earliest: { w: 39 },
      latest: { w: 39, d: 6 },
      indication: 'Advanced maternal age 40 or over',
    },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — AMA',
      page: 2,
      text: 'Age over 40 at delivery: send for a fellow clinic visit, offer MFM referral, aspirin 81 mg from 12-36wks, weekly NST and MVP from 36wks, growth scan at 28-32wks, and induction at 39wks — mortality at that point is equal to 41wks for non-AMA patients.',
    },
  },
  {
    id: 'ama-growth-scan',
    category: 'imaging',
    title: 'Growth scan',
    rationale:
      'Screens for growth restriction, which is more common with advanced maternal age and would change delivery timing if found.',
    trigger: { field: 'ageAtDelivery', gte: 40 },
    tier: 'moderate',
    timing: { kind: 'once', start: { w: 28 }, end: { w: 32 } },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — AMA',
      page: 2,
      text: 'Growth scan at 28-32wks for age over 40.',
    },
  },
  {
    id: 'mental-health',
    category: 'counseling',
    title: 'Mental health — active anxiety or depression on medication',
    detail:
      'Shared decision making about continuing medication. Paroxetine is the only agent that must be stopped. In general patients should be encouraged to continue SSRIs.',
    rationale:
      'The risk of untreated maternal depression is generally greater than the risk of continued SSRI exposure, which is why the default is continuation rather than discontinuation. Paroxetine is the exception. Assess at every visit and monitor closely for postpartum depression, since antenatal depression is the strongest predictor of it.',
    trigger: { field: 'activeDepressionOrAnxietyOnMeds', eq: true },
    tier: 'moderate',
    tierReason: 'Active anxiety or depression on medication',
    timing: { kind: 'everyVisit' },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — Anxiety/Depression',
      page: 2,
      text: 'Shared decision making about stopping medication; paroxetine is the only one that must be stopped. Encourage continuing SSRIs in general. Assess mental health at all visits and monitor closely for postpartum depression.',
    },
  },
  {
    id: 'obesity-baseline',
    category: 'lab',
    title: 'Obesity — A1c with initial labs and nutrition referral',
    detail:
      'A1c at initial labs. 1hr GTT in the normal time frame. Offer nutritionist referral. Low threshold for a growth scan at 28-32wks if fundal height is abnormal.',
    rationale:
      'The early A1c is looking for undiagnosed pre-existing diabetes, which is a different condition from gestational diabetes and needs a different pathway. The routine GTT still happens at the usual time — the A1c does not replace it.',
    trigger: { field: 'bmiAtIntake', gt: 30 },
    tier: 'moderate',
    tierReason: 'BMI over 30 at onset of prenatal care',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — Obesity',
      page: 3,
      text: 'BMI over 30 at onset of prenatal care: A1c with initial labs, 1hr GTT in the normal time frame, offer nutritionist referral, and a low threshold for a growth scan at 28-32wks if fundal height is abnormal.',
    },
  },
  {
    id: 'obesity-testing-35-39',
    category: 'monitoring',
    title: 'Antenatal testing — BMI 35-39.9',
    rationale:
      'Testing starts at 36wks at this BMI range, four weeks later than for BMI 40 and above — the protocol scales surveillance intensity to the degree of obesity.',
    trigger: {
      all: [
        { field: 'bmiAtIntake', gte: 35 },
        { field: 'bmiAtIntake', lt: 40 },
      ],
    },
    tier: 'moderate',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 36 }, frequency: 'weekly' },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — Obesity',
      page: 3,
      text: 'BMI 35-39.9 at onset of prenatal care: weekly NST and MVP after 36wks.',
    },
  },
  {
    id: 'obesity-testing-40-plus',
    category: 'monitoring',
    title: 'Antenatal testing — BMI 40 or over',
    rationale:
      'Testing starts two weeks earlier than the 35-39.9 group, reflecting higher stillbirth risk at this BMI.',
    trigger: { field: 'bmiAtIntake', gte: 40 },
    tier: 'moderate',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 34 }, frequency: 'weekly' },
    source: {
      origin: 'protocol',
      section: 'MODERATE RISK — Obesity',
      page: 3,
      text: 'BMI over 40 at onset of prenatal care: weekly NST and MVP after 34wks.',
    },
  },
  {
    id: 'bariatric-vitamins',
    category: 'medication',
    title: 'Bariatric surgery — vitamin supplementation',
    detail:
      'Either two prenatal vitamins, or the usual post-surgical vitamins plus one prenatal vitamin.',
    rationale:
      'Malabsorption after bariatric surgery means a single prenatal vitamin may not meet pregnancy requirements.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    tierReason: 'History of bariatric surgery',
    timing: { kind: 'span', start: { w: 0 }, end: { w: 42 } },
    source: {
      origin: 'protocol',
      section: 'History of bariatric surgery',
      page: 3,
      text: 'Take either two prenatal vitamins, or the regular post-surgery vitamins plus one prenatal vitamin.',
    },
  },
  {
    id: 'bariatric-micronutrients',
    category: 'lab',
    title: 'Bariatric surgery — micronutrient monitoring',
    detail:
      'B12, iron studies, calcium, vitamin D and folate with the prenatal labs. If no deficiencies are found, check iron, ferritin, vitamin D and calcium once per trimester.',
    rationale:
      'Deficiencies that are tolerable outside pregnancy become clinically significant when fetal demand is added, so these are tracked serially rather than checked once.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'once per trimester' },
    source: {
      origin: 'protocol',
      section: 'History of bariatric surgery',
      page: 3,
      text: 'Check B12, iron studies, calcium, vitamin D and folate with the prenatal labs. If no deficiencies are noted, check iron, ferritin, vitamin D and calcium once per trimester.',
    },
  },
  {
    id: 'bariatric-glucose-monitoring',
    category: 'monitoring',
    title: 'Bariatric surgery — home glucose monitoring in place of GTT',
    detail:
      'Do not perform a 1hr or 3hr GTT. The patient checks blood glucose for two weeks somewhere in the 24-28 week range.',
    rationale:
      'The glucose load in a GTT can provoke dumping syndrome after bariatric surgery, and altered absorption makes the result unreliable. Two weeks of home monitoring gives the same information without either problem. This replaces the universal GTT rather than supplementing it.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    timing: { kind: 'once', start: { w: 24 }, end: { w: 28 } },
    suppresses: ['gtt-1hr-routine'],
    source: {
      origin: 'protocol',
      section: 'History of bariatric surgery',
      page: 3,
      text: 'Do not do a 1hr or 3hr GTT. Ask the patient to check blood glucose for two weeks in the 24-28 week range.',
    },
  },
  {
    id: 'bariatric-growth-scan',
    category: 'imaging',
    title: 'Bariatric surgery — growth scan',
    rationale:
      'Growth restriction is more common after bariatric surgery, and fundal height is less reliable in this population.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    timing: { kind: 'once', start: { w: 32 }, end: { w: 32, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'History of bariatric surgery',
      page: 3,
      text: 'Growth scan at 32wks.',
    },
  },
  {
    id: 'hypothyroid-management',
    category: 'lab',
    title: 'Hypothyroidism — TSH monitoring',
    detail:
      'Recheck TSH every 4wks until 20wks, then every 4wks only if not at goal. Check once more in the third trimester even if at goal.',
    rationale:
      'The pregnancy TSH target of under 2.5 is lower than the non-pregnant target because thyroid hormone requirements rise early and fetal neurodevelopment depends on maternal supply in the first trimester. Patients already on replacement are advised to increase by about 30% at conception — practically, doubling the daily dose on two days each week.',
    trigger: { field: 'hypothyroid', eq: true },
    tier: 'moderate',
    tierReason: 'Hypothyroidism',
    timing: { kind: 'recurring', start: { w: 0 }, end: { w: 20 }, interval: 'every 4 weeks' },
    pendingDecisions: [
      {
        on: 'Screening TSH, reflexed to T4',
        question: 'How should the thyroid screen be acted on?',
        branches: [
          {
            condition: 'TSH high, T4 normal',
            then: 'Risk-benefit discussion. There is no clear evidence that treating subclinical hypothyroidism improves outcomes, and ACOG recommends not treating.',
          },
          {
            condition: 'TSH elevated with low T4, no prior hypothyroid history',
            then: 'Check TPO antibodies and treat as hypothyroid',
          },
          { condition: 'Prior history of hypothyroidism', then: 'Treat to TSH under 2.5' },
        ],
      },
    ],
    source: {
      origin: 'protocol',
      section: 'Hypothyroidism',
      page: 3,
      text: 'TSH with screening labs, reflexed to T4. Recheck every 4wks until 20wks, then every 4wks only if not at goal, and once more in the third trimester even if at goal. Treat to TSH under 2.5. Advise increasing the thyroid dose by 30% at conception.',
    },
  },
  {
    id: 'hyperthyroid-management',
    category: 'lab',
    title: 'Hyperthyroidism',
    detail:
      'If TSH is low, check T4 and T3. If normal, subclinical hyperthyroidism needs no treatment. If T4 and T3 are elevated, check TSI; if elevated, treat as Graves disease.',
    rationale:
      'TSH is physiologically suppressed in the first trimester, particularly with hyperemesis gravidarum, so a low TSH alone does not mean hyperthyroidism. Treatment switches from propylthiouracil in the first trimester to methimazole in the second and third — PTU avoids methimazole embryopathy early, then methimazole avoids PTU hepatotoxicity later.',
    trigger: { field: 'hyperthyroid', eq: true },
    tier: 'moderate',
    tierReason: 'Hyperthyroidism',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'T3 and T4 every 2-4 weeks' },
    source: {
      origin: 'protocol',
      section: 'Hyperthyroid',
      page: 3,
      text: 'TSH is suppressed in the first trimester, especially with hyperemesis. If TSH is low, check T4 and T3; subclinical hyperthyroidism needs no treatment. If T4 and T3 are elevated, check TSI and treat as Graves if elevated. PTU 100-600 mg divided TID in the first trimester, then methimazole in the second and third. Check T3 and T4 every 2-4 weeks and consider endocrine referral.',
    },
  },
  {
    id: 'recurrent-uti',
    category: 'medication',
    title: 'Recurrent positive urine culture or pyelonephritis',
    detail:
      'Treatment options are nitrofurantoin (with a vague caution in the first trimester), cephalexin, or amoxicillin-clavulanate. Recheck the urine culture after treatment. Prophylaxis is nitrofurantoin 50-100 mg daily or cephalexin 250 mg daily.',
    rationale:
      'Prophylaxis is triggered by more than two positive cultures regardless of symptoms, or by any pyelonephritis this pregnancy — because asymptomatic bacteriuria in pregnancy progresses to pyelonephritis far more often than outside it, and pyelonephritis carries a real risk of preterm labour and sepsis.',
    trigger: {
      any: [
        { field: 'recurrentPositiveUrineCulture', eq: true },
        { field: 'pyelonephritisThisPregnancy', eq: true },
      ],
    },
    tier: 'moderate',
    tierReason: 'Recurrent bacteriuria or pyelonephritis in pregnancy',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'Positive Ucx in pregnancy',
      page: 3,
      text: 'Treat with nitrofurantoin, cephalexin or amoxicillin-clavulanate and recheck the culture afterwards. Give prophylaxis to anyone with more than two positive cultures regardless of symptoms, or with pyelonephritis in the current pregnancy.',
    },
  },
  {
    id: 'prior-preeclampsia-labs',
    category: 'lab',
    title: 'Baseline pre-eclampsia labs',
    detail:
      'CBC, CMP and urine protein:creatinine at the first visit. If P:C is 0.3 or above on intake labs, obtain a 24 hour urine protein.',
    rationale:
      'Establishes a baseline before pre-eclampsia could plausibly develop. Without it, a later abnormal result cannot be distinguished from pre-existing renal disease — which changes both the diagnosis and the management.',
    trigger: {
      any: [
        { field: 'priorPreeclampsia', eq: true },
        { field: 'priorGestationalHTN', eq: true },
      ],
    },
    tier: 'moderate',
    tierReason: 'History of pre-eclampsia or gestational hypertension',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 } },
    source: {
      origin: 'protocol',
      section: 'History of preeclampsia/ Gestational HTN',
      page: 4,
      text: 'Check baseline pre-eclampsia labs (CBC, CMP, urine protein:creatinine) at the first visit. If P:C is 0.3 or above, obtain a 24 hour urine protein. Start aspirin 81 mg at 12wks and continue to 36wks.',
    },
  },
  {
    id: 'covid-in-pregnancy',
    category: 'monitoring',
    title: 'COVID infection during pregnancy',
    detail:
      'If infection occurs before 28wks, start aspirin 81 mg and arrange a growth scan at 32wks. No antenatal testing or induction is recommended on this basis alone.',
    rationale:
      'Infection before 28wks is thought to affect placental function, which is why it prompts aspirin and a growth scan. The protocol is explicit that it does not by itself justify antenatal testing or earlier delivery.',
    trigger: { field: 'covidInfectionThisPregnancy', eq: true },
    tier: 'moderate',
    tierReason: 'COVID infection during pregnancy',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'COVID in pregnancy',
      page: 4,
      text: 'Vaccination and boosters are safe and recommended in pregnancy. For infection before 28wks, start aspirin 81 mg and do a growth scan at 32wks. No antenatal testing or induction is recommended.',
    },
  },

  // =========================================================================
  // HIGH RISK — OB fellow clinic at least once per trimester
  // =========================================================================
  {
    id: 'preterm-medically-indicated',
    category: 'counseling',
    title: 'Prior medically indicated preterm delivery — no intervention',
    rationale:
      'A medically indicated preterm birth does not predict spontaneous recurrence, so progesterone and cervical length screening are not indicated. Recording this explicitly prevents the intervention being added by reflex.',
    trigger: {
      all: [
        { field: 'priorPretermDelivery', eq: true },
        { field: 'pretermDeliveryType', eq: 'medicallyIndicated' },
      ],
    },
    tier: 'high',
    tierReason: 'Prior preterm delivery',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'History of preterm delivery',
      page: 4,
      text: 'If the preterm delivery was medically indicated, no intervention is indicated.',
    },
  },
  {
    id: 'preterm-cervical-incompetence',
    category: 'referral',
    title: 'Cervical incompetence — first trimester MFM referral',
    detail: 'Refer to MFM in the first trimester for consideration of cerclage.',
    rationale:
      'Timing is the point. Cerclage is placed in the first trimester or early second, so a referral made later has missed the window — which is why this is one of the few referrals the protocol pins to a trimester.',
    trigger: {
      all: [
        { field: 'priorPretermDelivery', eq: true },
        { field: 'pretermDeliveryType', eq: 'cervicalIncompetence' },
      ],
    },
    tier: 'high',
    tierReason: 'Prior preterm delivery due to cervical incompetence',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 13, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'History of preterm delivery',
      page: 4,
      text: 'If due to cervical incompetence (history of painless dilation), refer to MFM in the first trimester for consideration of cerclage.',
    },
  },
  {
    id: 'preterm-spontaneous-cl-screening',
    category: 'imaging',
    title: 'Cervical length screening',
    detail: 'Offer at 16, 20 and 24wks. If length is under 2.5 cm, refer to MFM and start vaginal progesterone.',
    rationale:
      'Serial rather than single measurement, because a cervix that is shortening over time carries different risk from one that is short but stable. Recurrence risk is higher with multiple prior preterm births before 35wks, a short interpregnancy interval, tobacco use, and — as the protocol frames it — exposure to systemic racism rather than race itself.',
    trigger: {
      all: [
        { field: 'priorPretermDelivery', eq: true },
        { field: 'pretermDeliveryType', eq: 'spontaneous' },
      ],
    },
    tier: 'high',
    tierReason: 'Prior spontaneous preterm delivery',
    timing: { kind: 'recurring', start: { w: 16 }, end: { w: 24 }, interval: 'at 16, 20 and 24 weeks' },
    source: {
      origin: 'protocol',
      section: 'History of preterm delivery',
      page: 4,
      text: 'For a history of spontaneous preterm delivery, assess recurrence risk — higher with multiple preterm births before 35wks, exposure to systemic racism, short interpregnancy interval and tobacco use. Offer cervical length screening at 16, 20 and 24wks; if under 2.5 cm, refer to MFM and start vaginal progesterone.',
    },
  },
  {
    id: 'preterm-progesterone',
    category: 'medication',
    title: 'Vaginal progesterone',
    detail: '200 mcg vaginally daily from 16 to 36wks.',
    rationale:
      'There is no benefit to starting after 22wks, so this is time-critical. ACOG recommends offering it despite weak evidence, and the protocol follows that — worth being straightforward with patients about the strength of the evidence.',
    trigger: {
      all: [
        { field: 'priorPretermDelivery', eq: true },
        { field: 'pretermDeliveryType', eq: 'spontaneous' },
      ],
    },
    tier: 'high',
    timing: { kind: 'span', start: { w: 16 }, end: { w: 36 } },
    source: {
      origin: 'protocol',
      section: 'History of preterm delivery',
      page: 4,
      text: 'Offer vaginal progesterone, especially for high risk patients. ACOG recommends offering it despite weak evidence. 200 mcg vaginally daily from 16-36wks; there is no benefit to starting after 22wks.',
    },
  },
  {
    id: 'incidental-short-cervix',
    category: 'medication',
    title: 'Incidental short cervix',
    detail:
      'Refer to MFM. Vaginal progesterone 200 mcg daily through 36wks. Repeat cervical length at 24wks; if it continues to shorten, refer to MFM again.',
    rationale:
      'Distinct from the prior-preterm-birth pathway: this is a short cervix found on the anatomy scan in someone with no preterm history. The protocol notes the evidence for progesterone is good here, unlike the weaker evidence in the recurrence setting.',
    trigger: {
      all: [{ field: 'cervicalLengthMm', lt: 25 }, { not: { field: 'priorPretermDelivery', eq: true } }],
    },
    tier: 'high',
    tierReason: 'Short cervix on anatomy ultrasound',
    timing: { kind: 'span', start: { w: 20 }, end: { w: 36 } },
    source: {
      origin: 'protocol',
      section: 'Incidental short cervix',
      page: 4,
      text: 'No history of preterm delivery but cervical length under 2.5 cm on the anatomy scan: refer to MFM, give vaginal progesterone 200 mcg daily through 36wks — good evidence supports this — and repeat cervical length at 24wks, referring again if it continues to shorten.',
    },
  },
  {
    id: 'gdm-a1',
    category: 'monitoring',
    title: 'A1 (diet controlled) GDM',
    detail:
      'Glucose goals: fasting under 95, 1hr postprandial under 140, or 2hr postprandial under 120. Counsel on diet and offer diabetic educator referral. Growth scan at 32wks. No antenatal testing.',
    rationale:
      'Diet-controlled GDM carries enough lower risk that the protocol asks for no antenatal testing at all and allows delivery up to 40w6d — a deliberate contrast with A2, and the reason classifying correctly matters. If a quarter or more of readings are off goal, medication starts and the patient becomes A2.',
    trigger: { all: [{ field: 'gdm', eq: true }, { field: 'gdmClass', eq: 'A1' }] },
    tier: 'high',
    tierReason: 'Gestational diabetes, diet controlled',
    timing: { kind: 'once', start: { w: 32 }, end: { w: 32, d: 6 } },
    delivery: {
      action: 'deliverBy',
      latest: { w: 40, d: 6 },
      indication: 'A1 GDM',
    },
    source: {
      origin: 'protocol',
      section: 'Gestational DM',
      page: 4,
      text: 'A1 (diet controlled) GDM: growth scan at 32wks, no antenatal testing, delivery before 40w6d. Glucose goals are fasting under 95, 1hr postprandial under 140 or 2hr postprandial under 120. If 25% or more are not at goal, start medication — insulin first line, metformin second, glyburide third.',
    },
  },
  {
    id: 'gdm-a2',
    category: 'monitoring',
    title: 'A2 (medication controlled) GDM',
    detail:
      'Monthly ultrasound for estimated fetal weight, growth and fluid. Counsel on diet and offer diabetic educator referral. Insulin is first line, metformin second, glyburide third.',
    rationale:
      'Needing medication marks a degree of hyperglycaemia associated with macrosomia and stillbirth, which is why A2 gets monthly growth scans, weekly testing from 32wks, and a delivery window more than a week earlier than A1. Testing moves to twice weekly if control is poor.',
    trigger: { all: [{ field: 'gdm', eq: true }, { field: 'gdmClass', eq: 'A2' }] },
    tier: 'high',
    tierReason: 'Gestational diabetes requiring medication',
    timing: { kind: 'recurring', start: { w: 28 }, interval: 'monthly growth scan' },
    testing: { start: { w: 32 }, frequency: 'weekly' },
    assumption:
      'Assumes adequate control — weekly testing. If poorly controlled, testing moves to twice weekly and delivery timing should be discussed with MFM.',
    delivery: {
      action: 'recommendIOL',
      earliest: { w: 39 },
      latest: { w: 39, d: 6 },
      indication: 'A2 GDM',
    },
    source: {
      origin: 'protocol',
      section: 'Gestational DM',
      page: 4,
      text: 'A2 (medication controlled) GDM: monthly ultrasound for EFW, growth and fluid; weekly NST and MVP from 32wks, moving to twice weekly if poorly controlled; induction at 39w0d-39w6d. Poorly controlled patients may need earlier delivery — discuss with MFM.',
    },
  },
  {
    id: 'gdm-efw-referral',
    category: 'referral',
    title: 'Refer to MFM for abnormal estimated fetal weight',
    rationale:
      'Growth at either extreme changes delivery planning, and the protocol wants MFM confirming the estimate before it drives a decision as significant as a primary caesarean.',
    trigger: {
      all: [
        { field: 'gdm', eq: true },
        { any: [{ field: 'efwPercentile', lt: 10 }, { field: 'efwPercentile', gt: 90 }] },
      ],
    },
    tier: 'high',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'Gestational DM',
      page: 4,
      text: 'If EFW is below the 10th or above the 90th centile, refer to MFM.',
    },
  },
  {
    id: 'pregestational-dm',
    category: 'monitoring',
    title: 'Pre-existing diabetes',
    detail:
      'Refer to MFM for anatomy scan and fetal echocardiogram at 20wks, with growth scans every 4 weeks. Patient checks blood glucose from diagnosis; goals and medication management are the same as for GDM. Stop ACE inhibitors and convert to insulin if already on other agents.',
    rationale:
      'Fundamentally different from GDM because hyperglycaemia was present during organogenesis — hence the fetal echocardiogram, which GDM does not require. Twice-weekly testing from 32wks reflects the higher stillbirth risk.',
    trigger: { field: 'pregestationalDiabetes', eq: true },
    tier: 'high',
    tierReason: 'Pre-existing diabetes',
    timing: { kind: 'recurring', start: { w: 20 }, interval: 'growth scans every 4 weeks with MFM' },
    testing: { start: { w: 32 }, frequency: 'twiceWeekly' },
    source: {
      origin: 'protocol',
      section: 'Pre-existing DM2',
      page: 5,
      text: 'Antenatal testing twice weekly from 32wks. Refer to MFM for anatomy scan and fetal echocardiogram at 20wks, with growth scans every 4 weeks. Glucose goals and medication management are as for GDM. Stop ACE inhibitors and convert to insulin if already on medication.',
    },
  },
  {
    id: 'ghtn-preeclampsia',
    category: 'monitoring',
    title: 'Gestational hypertension / pre-eclampsia — see clinic flowsheet',
    detail:
      'This protocol defers management to a separate clinic flowsheet that is not part of the source document, so it is not encoded here.',
    rationale:
      'Flagged explicitly rather than omitted. A resident should not read the absence of pre-eclampsia guidance in this tool as meaning there is nothing to do — the guidance exists, it simply lives elsewhere.',
    trigger: { askUser: 'Has the patient developed gestational hypertension or pre-eclampsia?' },
    tier: 'high',
    assumeWhenUnresolved: false,
    assumption: 'Not assumed present. Listed as conditional until confirmed.',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'GHTN/ Pre E',
      page: 5,
      text: 'See the clinic flowsheet.',
    },
  },
  {
    id: 'chronic-htn',
    category: 'monitoring',
    title: 'Chronic hypertension',
    detail:
      'Stop ACE inhibitors, ARBs, diuretics and statins. Baseline pre-eclampsia labs (CBC, CMP, urine protein) at diagnosis; if urine P:C is 0.3 or above, get a 24 hour urine protein. Repeat labs every 3-4 weeks. If not previously on medication, start for BP over 140/90. If already on medication, change to labetalol twice daily or nifedipine. Goal BP under 140/90.',
    rationale:
      'Defined as BP over 140/90 on two occasions more than 3 hours apart before 20wks — the "before 20wks" is what distinguishes it from gestational hypertension. ACE inhibitors and ARBs are stopped for fetal renal toxicity; labetalol and nifedipine are the agents with the best pregnancy safety record. Serial labs establish whether superimposed pre-eclampsia is developing on top of the chronic disease.',
    trigger: { field: 'chronicHypertension', eq: true },
    tier: 'high',
    tierReason: 'Chronic hypertension',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'every 3-4 weeks' },
    source: {
      origin: 'protocol',
      section: 'Chronic HTN',
      page: 5,
      text: 'Chronic hypertension is BP over 140/90 on two separate occasions more than 3 hours apart before 20wks. Stop ACE inhibitors, ARBs, diuretics and statins. Baseline pre-eclampsia labs at diagnosis, then every 3-4 weeks. Aspirin 81 mg from 12-36wks.',
    },
  },
  {
    id: 'chronic-htn-off-meds',
    category: 'delivery',
    title: 'Chronic HTN — well controlled without medication',
    rationale:
      'No antenatal testing is required when blood pressure is controlled without medication, and delivery can wait a week longer than for patients needing treatment. The protocol notes this should now be a rare situation.',
    trigger: {
      all: [
        { field: 'chronicHypertension', eq: true },
        { field: 'bpControl', eq: 'controlledOffMeds' },
      ],
    },
    tier: 'high',
    timing: { kind: 'atDiagnosis' },
    delivery: {
      action: 'deliverBy',
      earliest: { w: 38 },
      latest: { w: 39, d: 6 },
      indication: 'Chronic HTN, controlled without medication',
    },
    source: {
      origin: 'protocol',
      section: 'Chronic HTN',
      page: 5,
      text: 'Well controlled off medication: no antenatal testing. Delivery 38w0d-39w6d.',
    },
  },
  {
    id: 'chronic-htn-on-meds',
    category: 'delivery',
    title: 'Chronic HTN — controlled on medication',
    rationale:
      'Needing medication marks enough placental risk to justify weekly surveillance from 32wks and delivery up to two weeks earlier than an untreated patient. Position within the window depends on how well controlled.',
    trigger: {
      all: [
        { field: 'chronicHypertension', eq: true },
        { field: 'bpControl', eq: 'controlledOnMeds' },
      ],
    },
    tier: 'high',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 32 }, frequency: 'weekly' },
    delivery: {
      action: 'deliverBy',
      earliest: { w: 37 },
      latest: { w: 39, d: 6 },
      indication: 'Chronic HTN, controlled on medication',
      caveat: 'Position within the window depends on how well controlled.',
    },
    source: {
      origin: 'protocol',
      section: 'Chronic HTN',
      page: 5,
      text: 'Controlled on medication: weekly antenatal testing from 32wks. Delivery 37w0d-39w6d depending on control.',
    },
  },
  {
    id: 'chronic-htn-uncontrolled',
    category: 'delivery',
    title: 'Chronic HTN — uncontrolled on medication',
    rationale:
      'Persistent hypertension despite treatment doubles the surveillance frequency and pushes delivery toward the early end of the window, since the placental insult is ongoing.',
    trigger: {
      all: [
        { field: 'chronicHypertension', eq: true },
        { field: 'bpControl', eq: 'uncontrolledOnMeds' },
      ],
    },
    tier: 'high',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 32 }, frequency: 'twiceWeekly' },
    delivery: {
      action: 'deliverBy',
      earliest: { w: 37 },
      latest: { w: 39, d: 6 },
      indication: 'Chronic HTN, uncontrolled on medication',
      caveat: 'Poor control argues for the earlier end of the window.',
    },
    source: {
      origin: 'protocol',
      section: 'Chronic HTN',
      page: 5,
      text: 'Uncontrolled on medication: twice-weekly antenatal testing from 32wks. Delivery 37w0d-39w6d depending on control.',
    },
  },
  {
    id: 'chronic-htn-growth-scan',
    category: 'imaging',
    title: 'Chronic hypertension — growth scan',
    rationale:
      'Chronic hypertension impairs placental perfusion, so growth restriction is the complication being screened for.',
    trigger: { field: 'chronicHypertension', eq: true },
    tier: 'high',
    timing: { kind: 'once', start: { w: 32 }, end: { w: 32, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'Chronic HTN',
      page: 5,
      text: 'Growth ultrasound when indicated, or at 32wks.',
    },
  },
  {
    id: 'growth-abnormality',
    category: 'imaging',
    title: 'Fetal growth restriction or macrosomia',
    detail:
      'If fundal height is more than 2 cm from expected in either direction, get a growth ultrasound. In patients at high risk for SGA or LGA, one abnormal measurement is enough; otherwise wait for two.',
    rationale:
      'Check that radiology used the correct EDD before acting on the result — a wrong EDD is a common cause of a spurious growth abnormality. Above the 90th or below the 10th centile goes to MFM for a repeat scan, and delivery timing then follows MFM recommendations. A primary caesarean may be offered for EFW over 5000 g, or over 4500 g in a diabetic patient, but only after MFM confirms the estimate.',
    trigger: {
      any: [
        { field: 'fundalHeightDiscrepancyCm', gt: 2 },
        { field: 'efwPercentile', lt: 10 },
        { field: 'efwPercentile', gt: 90 },
      ],
    },
    tier: 'high',
    tierReason: 'Fetal growth abnormality',
    timing: { kind: 'atDiagnosis' },
    delivery: {
      action: 'perMFM',
      indication: 'Fetal growth abnormality',
      caveat: 'Timing depends on MFM recommendations.',
    },
    source: {
      origin: 'protocol',
      section: 'Fetal Growth Restriction or fetal macrosomia',
      page: 5,
      text: 'Get a growth ultrasound if fundal height is more than 2 cm from expected. One abnormal measurement suffices in patients at high risk for SGA or LGA; otherwise wait for two. Confirm radiology used the correct EDD. Refer above the 90th or below the 10th centile to MFM for a repeat scan. Delivery timing depends on MFM. Offer primary caesarean for EFW over 5000 g, or over 4500 g in a diabetic, only after MFM confirms the estimate.',
    },
  },
  {
    id: 'prior-cesarean',
    category: 'counseling',
    title: 'Prior caesarean — TOLAC counselling',
    detail:
      'Document scar type, reason for the caesarean, and complications; request surgical records if not in Epic. Note placental position on ultrasound. Schedule with the OB fellow in the second trimester for TOLAC versus repeat caesarean counselling. Follow with a caesarean-capable provider after 36wks.',
    rationale:
      'Scar type is the decisive fact — a classical scar makes TOLAC unsafe, and without records that cannot be established. Placental position matters because an anterior placenta over the scar raises accreta risk. Counselling happens in the second trimester so the decision is made with time rather than in labour.',
    trigger: { field: 'priorCesarean', eq: true },
    tier: 'high',
    tierReason: 'Prior caesarean section',
    timing: { kind: 'once', start: { w: 14 }, end: { w: 27, d: 6 } },
    source: {
      origin: 'protocol',
      section: 'Prior C-section',
      page: 6,
      text: 'Document scar type, reason and complications, requesting surgical records if not in Epic. Note placental position on ultrasound. Schedule with the OB fellow in the second trimester for TOLAC versus repeat caesarean counselling. Follow with a caesarean provider after 36wks. Tubal ligation is not available at our hospital — refer to Clinica or another Avista group, and the Med-178 must be signed by 35wks.',
    },
  },
  {
    id: 'tubal-ligation-planning',
    category: 'documentation',
    title: 'Tubal ligation — referral and consent deadline',
    detail:
      'Tubal ligation is not available at our hospital. Refer to Clinica or another Avista group. The Med-178 must be signed by 35wks.',
    rationale:
      'A hard administrative deadline that is easy to miss and cannot be recovered late — if the form is not signed by 35wks the procedure cannot proceed at delivery, regardless of the patient\'s wishes.',
    trigger: { field: 'priorCesarean', eq: true },
    tier: 'high',
    timing: { kind: 'once', start: { w: 20 }, end: { w: 35 } },
    source: {
      origin: 'protocol',
      section: 'Prior C-section',
      page: 6,
      text: 'Tubal ligation is not an option at our hospital; refer to Clinica or another Avista group. The Med-178 needs signing by 35wks.',
    },
  },
  {
    id: 'breech-presentation',
    category: 'imaging',
    title: 'Breech presentation',
    detail:
      'Discuss the Spinning Babies website. Ultrasound at 36wks; if still breech, refer to Fellow Clinic to discuss caesarean versus external cephalic version.',
    rationale:
      'Most breech presentations before 36wks resolve on their own, which is why nothing is done earlier. After 36wks the window for ECV is narrow, so scheduling can be expedited by messaging Trevor.',
    trigger: { field: 'presentation', eq: 'breech' },
    tier: 'high',
    tierReason: 'Breech presentation',
    timing: { kind: 'once', start: { w: 36 }, end: { w: 36, d: 6 } },
    pendingDecisions: [
      {
        at: { w: 36 },
        question: 'Is the fetus still breech at the 36 week ultrasound?',
        branches: [
          { condition: 'Now vertex', then: 'No further breech-specific management' },
          {
            condition: 'Still breech',
            then: 'Refer to Fellow Clinic to discuss caesarean versus ECV. Messaging Trevor can expedite ECV scheduling.',
          },
        ],
      },
    ],
    source: {
      origin: 'protocol',
      section: 'Breech Presentation',
      page: 6,
      text: 'Discuss the Spinning Babies website. Ultrasound at 36wks; if still breech, refer to Fellow Clinic for discussion of caesarean versus ECV. Trevor can expedite ECV scheduling.',
    },
  },
  {
    id: 'placenta-previa',
    category: 'imaging',
    title: 'Placenta previa surveillance',
    detail:
      'L&D precautions for active bleeding. Avoid digital vaginal examinations. Advise pelvic rest.',
    rationale:
      'Applies when a second trimester scan shows the placental edge over the internal os or within 2 cm of it. Many resolve as the lower segment develops, which is why serial scans at 32 and 36wks come before any delivery decision. Digital examination can provoke catastrophic haemorrhage, so the precaution matters from the moment previa is suspected.',
    trigger: { field: 'placentaPrevia', eq: true },
    tier: 'high',
    tierReason: 'Placenta previa',
    timing: { kind: 'once', start: { w: 32 }, end: { w: 32, d: 6 } },
    pendingDecisions: [
      {
        at: { w: 32 },
        question: 'Is the previa still present at the 32 week ultrasound?',
        branches: [
          { condition: 'Resolved', then: 'No further previa-specific imaging' },
          { condition: 'Still abnormal', then: 'Repeat ultrasound at 36wks and refer to HR OB clinic' },
        ],
      },
      {
        at: { w: 36 },
        question: 'Is the previa still present at the 36 week ultrasound?',
        branches: [
          { condition: 'Resolved', then: 'Previa-specific delivery plan no longer applies' },
          {
            condition: 'Still present',
            then: 'Schedule caesarean between 36w0d and 37w6d. HR OB clinic decides on transfer to WHS.',
          },
        ],
      },
    ],
    delivery: {
      action: 'scheduledCesarean',
      earliest: { w: 36 },
      latest: { w: 37, d: 6 },
      indication: 'Persistent placenta previa at 36wk ultrasound',
      caveat: 'Applies only if previa is still present on the 36 week scan.',
    },
    source: {
      origin: 'protocol',
      section: 'Placenta Previa',
      page: 6,
      text: 'Applies if a second trimester ultrasound shows the placental edge over the internal os or within 2 cm of it. Repeat at 32wks; if still abnormal, repeat at 36wks and refer to HR OB clinic, which decides on transfer to WHS. If previa persists at the 36wk scan, schedule caesarean between 36 and 37w6d.',
    },
  },
  {
    id: 'accreta-risk',
    category: 'referral',
    title: 'Accreta risk — MFM referral for ultrasound',
    rationale:
      'Accreta needs identifying antenatally because it changes where and how delivery happens entirely. The protocol casts the net wide: any previa counts, as does a prior caesarean with an anterior placenta — the scar and the placenta being in the same place is the mechanism, so previa is not required for that second route.',
    trigger: {
      any: [
        { field: 'placentaPrevia', eq: true },
        { all: [{ field: 'priorCesarean', eq: true }, { field: 'anteriorPlacenta', eq: true }] },
      ],
    },
    tier: 'veryHigh',
    tierReason: 'Possible accreta — previa, or prior caesarean with anterior placenta',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'Placenta Previa',
      page: 6,
      text: 'Possible accreta covers all placenta previa, and any prior caesarean with an anterior placenta. Refer to MFM for ultrasound.',
    },
  },
  {
    id: 'prior-fetal-demise',
    category: 'monitoring',
    title: 'History of fetal demise after 20 weeks',
    detail:
      'Offer MFM referral. A1c in early pregnancy and offer genetic screening with cfDNA. Consider aspirin 81 mg from 12 to 36wks. Growth scan at 32wks.',
    rationale:
      'Excludes losses caused by cervical incompetence, which follow the cerclage pathway instead. Testing is timed relative to the gestational age of the previous loss rather than to a fixed week — surveillance begins before the point at which the previous pregnancy was lost. Delivery is offered at 39wks for all patients with a history of fetal loss.',
    trigger: { field: 'priorFetalDemiseAfter20wks', eq: true },
    tier: 'high',
    tierReason: 'Prior fetal demise after 20 weeks',
    timing: { kind: 'once', start: { w: 32 }, end: { w: 32, d: 6 } },
    testing: {
      start: { w: 32 },
      frequency: 'twiceWeekly',
      startNote:
        'If the prior loss was after 34wks, start 1-2 weeks before the gestational age at which it occurred. Testing may be offered to anyone after 36wks.',
    },
    delivery: {
      action: 'offerIOL',
      earliest: { w: 39 },
      latest: { w: 39, d: 6 },
      indication: 'History of fetal demise',
      caveat:
        'With a history of term loss, recommend MFM referral and consider delivery at 37wks.',
    },
    source: {
      origin: 'protocol',
      section: 'Hx of fetal demise > 20wks',
      page: 6,
      text: 'Not applicable where the loss was due to cervical incompetence. Offer MFM referral, A1c in early pregnancy and genetic screening with cfDNA. Consider aspirin 81 mg from 12-36wks and a growth scan at 32wks. If the loss was after 34wks, start twice-weekly NST 1-2 weeks before the gestational age of the previous stillbirth. Antenatal testing may be offered to anyone after 36wks. Offer delivery at 39wks for all patients with a history of fetal loss; with a term loss, recommend MFM referral and consider delivery at 37wks.',
    },
  },
  {
    id: 'cholestasis',
    category: 'monitoring',
    title: 'Cholestasis of pregnancy',
    detail:
      'Treat with ursodeoxycholic acid 10-15 mg/kg/day divided into 2-3 doses, to a maximum of 21 mg/kg/day.',
    rationale:
      'Suspect it with itching of the palms and soles, especially at night. A raised total bile acid level is diagnostic; check a CMP too, since AST and ALT can rise. Labs can lag symptoms by up to three weeks, so a normal early result does not exclude the diagnosis and should be repeated. Delivery timing turns on the bile acid level because stillbirth risk rises sharply above 100.',
    trigger: { field: 'cholestasis', eq: true },
    tier: 'high',
    tierReason: 'Cholestasis of pregnancy',
    timing: { kind: 'atDiagnosis' },
    testing: { start: { w: 32 }, frequency: 'weekly' },
    assumption:
      'Assumes bile acids under 100 — delivery 36-39wks. Above 100, delivery at 36wks with steroids and an MFM discussion.',
    delivery: {
      action: 'deliverBy',
      earliest: { w: 36 },
      latest: { w: 39 },
      indication: 'Cholestasis, bile acids under 100',
      caveat:
        'Bile acids over 100: deliver at 36wks with steroids. This is very high risk — discuss with MFM.',
    },
    source: {
      origin: 'protocol',
      section: 'Cholestasis of pregnancy',
      page: 6,
      text: 'Suspect in a patient with itching of the palms and soles, especially at night. A raised total bile acid level is diagnostic; check a CMP as AST and ALT can rise, and note labs can lag symptoms by up to three weeks. Treat with ursodeoxycholic acid 10-15 mg/kg/day divided 2-3 times daily, maximum 21 mg/kg/day. Weekly NST and MVP from 32wks. Deliver at 36wks with steroids if bile acids are over 100 — very high risk, discuss with MFM — or between 36 and 39wks if under 100.',
    },
  },

  // =========================================================================
  // VERY HIGH RISK — refer to MFM
  // =========================================================================
  {
    id: 'mfm-multiple-gestation',
    category: 'referral',
    title: 'Multiple gestation — refer to MFM, then transfer care to WHS',
    rationale:
      'The only condition on the very-high-risk list where care leaves family medicine entirely rather than being co-managed. The rest of this plan does not apply once care transfers.',
    trigger: { field: 'plurality', eq: 'multiple' },
    tier: 'veryHigh',
    tierReason: 'Multiple gestation',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Multiple gestation — refer to MFM, then transfer care to WHS.',
    },
  },
  {
    id: 'mfm-type-1-diabetes',
    category: 'referral',
    title: 'Type 1 diabetes — refer to MFM',
    rationale:
      'Glycaemic control in type 1 diabetes through pregnancy needs specialist management, and the risks of malformation, growth abnormality and stillbirth are all substantially raised.',
    trigger: { field: 'diabetesType', eq: 'type1' },
    tier: 'veryHigh',
    tierReason: 'Type 1 diabetes',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Type 1 diabetes — refer to MFM.',
    },
  },
  {
    id: 'mfm-infectious',
    category: 'referral',
    title: 'Chronic hepatitis, active syphilis, tuberculosis or HIV — refer to MFM',
    rationale:
      'Each carries a risk of vertical transmission that can be reduced by specific antenatal and intrapartum management, so specialist input changes outcomes directly.',
    trigger: {
      any: [
        { field: 'chronicHepatitis', eq: true },
        { field: 'activeSyphilis', eq: true },
        { field: 'tuberculosis', eq: true },
        { field: 'hiv', eq: true },
      ],
    },
    tier: 'veryHigh',
    tierReason: 'Chronic hepatitis, active syphilis, tuberculosis or HIV',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Chronic hepatitis, active syphilis infection, tuberculosis or HIV — refer to MFM.',
    },
  },
  {
    id: 'mfm-seizure-disorder',
    category: 'referral',
    title: 'Seizure disorder — refer to MFM',
    rationale:
      'May need high dose folic acid in the first trimester, and antiepileptic choice has to balance seizure control against teratogenicity.',
    trigger: { field: 'seizureDisorder', eq: true },
    tier: 'veryHigh',
    tierReason: 'Seizure disorder',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Seizure disorder — refer to MFM. May need high dose folic acid in the first trimester.',
    },
  },
  {
    id: 'mfm-thrombotic',
    category: 'referral',
    title: 'Clotting disorder, active DVT or PE — refer to MFM',
    rationale:
      'Pregnancy is already prothrombotic, and anticoagulation decisions around delivery need specialist planning.',
    trigger: {
      any: [{ field: 'clottingDisorder', eq: true }, { field: 'activeDvtOrPe', eq: true }],
    },
    tier: 'veryHigh',
    tierReason: 'Clotting disorder or active venous thromboembolism',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'History of clotting disorder, or active DVT or PE — refer to MFM.',
    },
  },
  {
    id: 'mfm-organ-disease',
    category: 'referral',
    title: 'Renal, cardiac, lung or autoimmune disease — refer to MFM',
    rationale:
      'Each involves organ systems under substantially increased physiologic load in pregnancy. Asthma qualifies only if poorly controlled.',
    trigger: {
      any: [
        { field: 'renalDisease', eq: true },
        { field: 'heartDisease', eq: true },
        { field: 'lungDisease', eq: true },
        { field: 'autoimmuneDisease', eq: true },
      ],
    },
    tier: 'veryHigh',
    tierReason: 'Renal, cardiac, lung or autoimmune disease',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Renal disease, heart disease, poorly controlled asthma or other lung disease, autoimmune disease or lupus — refer to MFM.',
    },
  },
  {
    id: 'mfm-positive-antibody',
    category: 'referral',
    title: 'Positive antibody screen — refer to MFM',
    rationale:
      'Management varies considerably depending on which antibody is involved, so the protocol asks that Trevor be consulted first rather than applying a single pathway.',
    trigger: { field: 'positiveAntibodyScreen', eq: true },
    tier: 'veryHigh',
    tierReason: 'Positive antibody screen',
    timing: { kind: 'atDiagnosis' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Positive antibody — this varies depending on the antibody, so ask Trevor first.',
    },
  },
  {
    id: 'mfm-return-to-fm',
    category: 'visit',
    title: 'Follow in OB Fellow Clinic after return from MFM',
    rationale:
      'Patients returned to family medicine after MFM review are not simply back to routine care — they keep a regular fellow clinic presence, alternating with other providers.',
    trigger: { askUser: 'Has this patient been seen by MFM and returned to family medicine for care?' },
    tier: 'high',
    assumeWhenUnresolved: false,
    assumption: 'Not assumed. Listed as conditional until confirmed.',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'regularly, alternating with other providers' },
    source: {
      origin: 'protocol',
      section: 'VERY HIGH RISK',
      page: 7,
      text: 'Patients with these conditions who are seen by MFM and returned to family medicine should be followed regularly in the OB Fellow Clinic, alternating visits with other providers.',
    },
  },
];


// ==========================================================================
// FROM engine.ts
// ==========================================================================

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
// Buckets
// ---------------------------------------------------------------------------

/**
 * Where an item sits relative to today.
 *
 *   overdue — its window closed before today
 *   now     — its window is open, or opens within the next week
 *   future  — it opens later than that
 *
 * `overdue` means the window has passed, NOT that the item was missed. The
 * tool has no record of what was actually done, so the wording in the UI has
 * to stay "window passed", never "you failed to do this".
 */
export type Bucket = 'overdue' | 'now' | 'future';

/** How far ahead counts as "this week". */
const SOON_DAYS = 7;
const TERM = 42 * 7;

export function bucketOf(t: Timing, nowDays: number): Bucket {
  // Not tied to a gestational age: actionable as soon as the condition is
  // known, so it always belongs in the current bucket.
  if (t.kind === 'atDiagnosis' || t.kind === 'everyVisit') return 'now';

  const start = gaDays(t.start);
  const end =
    'end' in t && t.end ? gaDays(t.end) : t.kind === 'recurring' ? TERM : start;

  if (nowDays > end) return 'overdue';
  if (nowDays >= start - SOON_DAYS) return 'now';
  return 'future';
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

  /** Overdue / now / future, relative to today's gestational age. */
  bucket: Bucket;

  /**
   * Profile fields that are set and that this rule's trigger actually reads.
   * The exact answer to "which inputs caused this item".
   */
  causedBy: string[];
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
  const dating = computeDating(profile, today);

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
      bucket: dating ? bucketOf(rule.timing, dating.currentGaDays) : 'future',
      causedBy: [...new Set(fieldsIn(rule.trigger))].filter(
        (f) => (profile as Record<string, unknown>)[f] !== undefined,
      ),
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
    dating,
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
