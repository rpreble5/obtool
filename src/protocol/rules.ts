import type { Rule } from './types';

/**
 * FORMAT-CHECK BATCH — 14 of ~40 rules.
 *
 * These were chosen not because they are the easiest but because between
 * them they exercise every hard feature of the schema: risk counting,
 * suppression, pending decisions, reflex trees, conflicting delivery
 * windows, external references, and the protocol-notes mechanism.
 *
 * Source: "Family Medicine OB Patient Care", FMC OB Patient Care Update
 * 5_2022, header marked "Edit 4/23". 7 pages.
 */

export const PROTOCOL_META = {
  title: 'Family Medicine OB Patient Care',
  documentTitle: 'FMC OB Patient Care Update 5_2022',
  edit: '4/23',
  pages: 7,
  /** Displayed prominently: this is a 2022 document last edited April 2023. */
  currencyWarning:
    'This protocol was authored in 2022 and last edited 4/23. Some content may have been overtaken by subsequent guidance. Verify against current practice before clinical use.',
};

export const RULES: Rule[] = [
  // =========================================================================
  // ALL PATIENTS
  // =========================================================================
  {
    id: 'prenatal-lab-panel',
    category: 'lab',
    title: 'Prenatal lab panel',
    detail:
      'ABO, Rh, antibody screen, CBC, Rubella IgG, HIV, RPR, Hep B surface antigen, Varicella, TSH, Hep C antibody, GC/Chlamydia, urine culture. Use Epic order "prenatal lab panel".',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 0 }, end: { w: 12 }, ideal: { w: 8 } },
    source: {
      section: 'All patients — First Visit',
      page: 1,
      quote:
        'Prenatal labs- ABO, Rh, antibody screen, CBC, Rubella IgG, HIV, RPR, Hep B Surface Antigen, Varicella, TSH, Hep C antibody, GC/Chlamydia, urine culture. Use Epic order "prenatal lab panel"',
    },
  },

  {
    id: 'dating-ultrasound',
    category: 'imaging',
    title: 'Dating ultrasound',
    detail:
      'Scheduled into OB Fellow Clinic or Harrington, Gayer, Ochs. If no availability, ok to order through radiology.',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 8 }, end: { w: 12 } },
    source: {
      section: 'All patients — 8-12wks',
      page: 1,
      quote:
        'Dating US. Scheduled into OB Fellow Clinic or Harrington, Gayer, Ochs. If no availability ok to order through radiology.',
    },
  },

  // --- The risk-counting rule ----------------------------------------------
  {
    id: 'asa-prophylaxis',
    category: 'medication',
    title: 'Aspirin 81 mg daily',
    detail:
      'Start at 12wks, continue through 36wks. The clinic default is to recommend ASA for all patients; opt out only after discussion with a truly low-risk patient.',
    // The clinic-wide default makes this universal. The risk factors below
    // do not gate the recommendation — they strengthen it — so they are
    // encoded as a separate scoring rule rather than as this rule's trigger.
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'span', start: { w: 12 }, end: { w: 36 } },
    source: {
      section: 'All patients — 8-12wks',
      page: 1,
      quote:
        'Discuss starting ASA 81 mg – start at 12wks through 36 wks. We now recommend ASA for ALL PATIENTS in our clinic. You can discuss with individual patients and opt out if they are truly low risk',
    },
    protocolNotes: [
      {
        kind: 'ambiguous',
        note: 'The clinic-wide "all patients" default and the risk-factor criteria are stated together without saying how they interact. Encoded as: universal default, with risk factors shown as supporting evidence.',
        proposedUpdate:
          'State explicitly whether the risk-factor list is now advisory only, or whether it still gates the recommendation for patients who decline the default.',
      },
    ],
  },

  {
    id: 'asa-risk-factors',
    category: 'counseling',
    title: 'Aspirin risk-factor assessment',
    detail:
      'Supports the ASA discussion. One high-risk factor, one specified moderate factor, or two other moderate factors meet criteria independent of the clinic-wide default.',
    trigger: {
      any: [
        // One high-risk factor
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
        // One moderate risk factor, per the protocol's separate short list
        {
          any: [
            { field: 'lowerIncome', eq: true },
            { field: 'blackRace', eq: true },
          ],
        },
        // Two moderate risk factors
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
      section: 'All patients — 8-12wks',
      page: 1,
      quote:
        'ASA is recommend for: One moderate risk: lower income, black race (due to underlying social inequity rather than biologic propensity). Two moderate risk factors: nulip, BMI >30, Fam Hx Pre-E, AMA, >10yr interpregnancy interval. One high risk factors: Hx of pre-E, gHTN, twins, chronic HTN, pre-existing diabetes, renal disease, autoimmune disease',
    },
    protocolNotes: [
      {
        kind: 'framing',
        note: 'The protocol explicitly attributes the race-based risk factor to social inequity rather than biology. This wording must be rendered inline wherever the field is displayed — a bare "Black race" checkbox alongside BMI and parity teaches the opposite of what the document says.',
        proposedUpdate:
          'Consider whether the modifiable drivers (access, care continuity, discrimination in prior care) can be captured directly, so race is not used as the proxy.',
      },
    ],
  },

  // --- The rule that gets suppressed ---------------------------------------
  {
    id: 'gtt-1hr-routine',
    category: 'lab',
    title: '1 hr GTT + H/H',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 26 }, end: { w: 28 } },
    source: {
      section: 'All patients',
      page: 2,
      quote: '26-28 wks    1 hr GTT, H/H',
    },
    pendingDecisions: [
      {
        on: '1 hr GTT result',
        question: 'How to interpret the 1 hr GTT?',
        branches: [
          { condition: '< 135', then: 'Normal — no further testing' },
          { condition: '135-200', then: 'Proceed to 3 hr GTT' },
          { condition: '> 200', then: 'Diagnostic of GDM — does NOT need 3 hr GTT' },
        ],
      },
    ],
  },

  // --- Implicit condition the protocol omits -------------------------------
  {
    id: 'anti-d-28wk',
    category: 'medication',
    title: 'Rhogam + repeat antibody screen',
    trigger: { field: 'rhNegative', eq: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 28 }, end: { w: 28, d: 6 } },
    source: {
      section: 'All patients',
      page: 2,
      quote: '28wks    Rhogam w/ repeat Ab screen',
    },
    protocolNotes: [
      {
        kind: 'implicit',
        note: 'Listed under "All patients" with no stated condition, but anti-D immune globulin applies only to Rh-negative patients. Encoded as gated on Rh status; encoding it literally would be wrong.',
        proposedUpdate:
          'Add "(Rh negative patients)" to this line in the source document.',
      },
    ],
  },

  {
    id: 'gbs-testing',
    category: 'lab',
    title: 'GBS testing',
    trigger: { always: true },
    tier: 'all',
    timing: { kind: 'once', start: { w: 35 }, end: { w: 36 } },
    source: { section: 'All patients', page: 2, quote: '35-36wks    GBS testing' },
  },

  // =========================================================================
  // MODERATE RISK
  // =========================================================================

  // --- Suppression -----------------------------------------------------
  {
    id: 'bariatric-glucose-monitoring',
    category: 'monitoring',
    title: 'Home glucose monitoring in place of GTT',
    detail:
      'Do NOT do 1hr or 3hr GTT. Patient checks blood glucose for 2 weeks somewhere in the 24-28 week range.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    tierReason: 'History of bariatric surgery',
    timing: { kind: 'once', start: { w: 24 }, end: { w: 28 } },
    suppresses: ['gtt-1hr-routine'],
    source: {
      section: 'History of bariatric surgery',
      page: 3,
      quote:
        'Do not do 1hr or 3hr GTT. Ask patient to check their blood glucose for 2 weeks in the 24-28 week range.',
    },
  },

  {
    id: 'bariatric-micronutrients',
    category: 'lab',
    title: 'Micronutrient panel',
    detail:
      'B12, iron studies, calcium, Vit D, folate with prenatal labs. If no deficiencies noted, check iron, ferritin, Vit D, calcium once per trimester.',
    trigger: { field: 'bariatricSurgery', eq: true },
    tier: 'moderate',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'once per trimester' },
    source: {
      section: 'History of bariatric surgery',
      page: 3,
      quote:
        'Check B12, iron studies, calcium, Vit D, folate with prenatal labs. If no deficiencies noted: check iron, ferratin, vit D, calcium once per trimester',
    },
  },

  // --- Reflex lab tree ------------------------------------------------------
  {
    id: 'hypothyroid-management',
    category: 'lab',
    title: 'TSH monitoring',
    detail:
      'Recheck TSH every 4wks until 20 wks, then every 4 wks ONLY IF not at goal. Check once more in the 3rd trimester even if at goal. Treat to TSH < 2.5 (lower than the non-pregnant target). Patients advised to increase thyroid dose by 30% at conception — double the daily dose on 2 days each week.',
    trigger: { field: 'hypothyroid', eq: true },
    tier: 'moderate',
    tierReason: 'Hypothyroidism',
    timing: { kind: 'recurring', start: { w: 0 }, end: { w: 20 }, interval: 'every 4 weeks' },
    pendingDecisions: [
      {
        on: 'Screening TSH, reflexed to T4',
        question: 'How to act on the thyroid screen?',
        branches: [
          {
            condition: 'TSH high, T4 normal',
            then: 'Risk/benefit discussion. No clear evidence that treating subclinical hypothyroidism improves outcomes; ACOG recommends not treating.',
          },
          {
            condition: 'TSH elevated with low T4, no prior hypothyroid history',
            then: 'Check TPO antibodies and treat as hypothyroid',
          },
          {
            condition: 'Prior history of hypothyroidism',
            then: 'Treat to TSH < 2.5',
          },
        ],
      },
    ],
    source: {
      section: 'Hypothyroidism',
      page: 3,
      quote:
        'TSH w screening labs reflex to > T4. Recheck TSH every 4wks until 20 wks, then every 4 wks ONLY IF not at goal. Check once more in the 3rd trimester even if at goal.',
    },
  },

  // =========================================================================
  // HIGH RISK
  // =========================================================================

  // --- Conflicting delivery window #1 --------------------------------------
  {
    id: 'chronic-htn',
    category: 'monitoring',
    title: 'Chronic hypertension management',
    detail:
      'Stop ACE/ARB, diuretics and statins. Baseline PIH labs (CBC, CMP, urine protein) at diagnosis; if urine P:C >= 0.3 at intake, get 24h urine protein. PIH labs q3-4 weeks. If not previously on meds, start for BP > 140/90. If previously on meds, change to labetalol BID or nifedipine. Goal BP < 140/90.',
    trigger: { field: 'chronicHypertension', eq: true },
    tier: 'high',
    tierReason: 'Chronic hypertension',
    timing: { kind: 'recurring', start: { w: 0 }, interval: 'every 3-4 weeks' },
    testing: { start: { w: 32 }, frequency: 'weekly', startNote: 'Controlled on meds' },
    delivery: {
      action: 'deliverBy',
      earliest: { w: 37 },
      latest: { w: 39, d: 6 },
      indication: 'Chronic HTN on medication',
      caveat: 'Exact timing within the window depends on how well controlled.',
    },
    conflictsWith: ['gdm-a2', 'ama-over-40', 'placenta-previa', 'cholestasis'],
    source: {
      section: 'Chronic HTN',
      page: 5,
      quote:
        'Delivery timing: If on meds: 37 0/7- 39 6/7 depending on how well controlled they are. If not on medications (should now be a rare occurrence): 38 0/7- 39 6/7. Antenatal testing: Well controlled no meds: no antenatal testing. Controlled on meds: 32 weeks weekly. Uncontrolled on meds: 32 weeks bi weekly',
    },
    protocolNotes: [
      {
        kind: 'ambiguous',
        note: 'Antenatal testing frequency and delivery window both vary by degree of control, which cannot be determined from intake data. The engine asks the user rather than assuming.',
      },
    ],
  },

  // --- Conflicting delivery window #2 --------------------------------------
  {
    id: 'gdm-a2',
    category: 'monitoring',
    title: 'A2 (medication-controlled) GDM',
    detail:
      'Blood glucose goals: fasting < 95, 1 hr PP < 140 or 2 hr PP < 120. If 25% or more not at goal, start meds — insulin first line, metformin second, glyburide third. Monthly ultrasound for EFW, growth, fluid. Counsel on diet; offer diabetic educator referral.',
    trigger: { all: [{ field: 'gdm', eq: true }, { field: 'gdmClass', eq: 'A2' }] },
    tier: 'high',
    tierReason: 'Gestational diabetes requiring medication',
    timing: { kind: 'recurring', start: { w: 28 }, interval: 'monthly growth scan' },
    testing: { start: { w: 32 }, frequency: 'weekly' },
    delivery: {
      action: 'recommendIOL',
      earliest: { w: 39 },
      latest: { w: 39, d: 6 },
      indication: 'A2 GDM',
    },
    conflictsWith: ['chronic-htn', 'ama-over-40', 'placenta-previa', 'cholestasis'],
    source: {
      section: 'Gestational DM',
      page: 4,
      quote:
        'A2 (medication controlled) GDM: US monthly to evaluate EFW, growth, fluid. Antenatal testing: A2 GDM: ONCE weekly NST/MVP at 32 wks. Move to twice weekly if poorly controlled. IOL: A2: 39w0d- 39w6d',
    },
  },

  // --- Pending decision -----------------------------------------------------
  {
    id: 'placenta-previa',
    category: 'imaging',
    title: 'Placenta previa surveillance',
    detail:
      'L&D precautions for active bleeding. Avoid digital vaginal exams. Advise pelvic rest.',
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
          { condition: 'Still abnormal', then: 'Repeat US at 36 wks and refer to HR OB clinic' },
        ],
      },
      {
        at: { w: 36 },
        question: 'Is the previa still present at the 36 week ultrasound?',
        branches: [
          { condition: 'Resolved', then: 'Previa-specific delivery plan no longer applies' },
          {
            condition: 'Still present',
            then: 'Schedule C-section between 36w0d and 37w6d. HR OB clinic decides on transfer to WHS.',
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
    conflictsWith: ['chronic-htn', 'gdm-a2', 'ama-over-40', 'cholestasis'],
    source: {
      section: 'Placenta Previa',
      page: 6,
      quote:
        'Repeat US at 32 wks, if still abnormal then repeat US at 36 wks and refer to HR OB clinic. HR OB clinic will review case and decide if they should be transferred to WHS. If previa still present on 36 wk US, then C-section should be scheduled between 36 to 37 6/7 wks',
    },
  },

  // --- Very high risk, and a rule that changes care ownership entirely ------
  {
    id: 'multiple-gestation',
    category: 'referral',
    title: 'Refer to MFM — then transfer care to WHS',
    trigger: { field: 'plurality', eq: 'multiple' },
    tier: 'veryHigh',
    tierReason: 'Multiple gestation',
    timing: { kind: 'atDiagnosis' },
    source: {
      section: 'VERY HIGH RISK',
      page: 7,
      quote: 'Multiple gestation – Then transfer care to WHS',
    },
    protocolNotes: [
      {
        kind: 'ambiguous',
        note: 'Care transfers out of FM entirely, so the rest of the generated plan does not apply. The UI should say so rather than render a full FM timeline underneath.',
      },
    ],
  },

  // --- External reference ---------------------------------------------------
  {
    id: 'ghtn-preeclampsia',
    category: 'monitoring',
    title: 'Gestational HTN / Pre-eclampsia — see clinic flowsheet',
    detail:
      'This protocol defers management to a separate clinic flowsheet that is not part of this document. Not encoded here.',
    trigger: { askUser: 'Has the patient developed gestational HTN or pre-eclampsia?' },
    tier: 'high',
    timing: { kind: 'atDiagnosis' },
    source: {
      section: 'GHTN/ Pre E',
      page: 5,
      quote: 'GHTN/ Pre E: See clinic flowsheet',
    },
    protocolNotes: [
      {
        kind: 'external',
        note: 'A major condition is deferred to a document we do not have. The plan surfaces this as an explicit gap rather than staying silent, so a resident does not read the absence as "nothing to do".',
        proposedUpdate:
          'Either fold the flowsheet into this document or link it, so the protocol is self-contained.',
      },
    ],
  },
];
