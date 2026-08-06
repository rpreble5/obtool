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
