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
  /** ISO date. Last menstrual period. */
  lmp?: string;
  /** ISO date. Estimated date of delivery, if already established. */
  edd?: string;
  /** True once dating has been confirmed by ultrasound. */
  datingConfirmedByUS?: boolean;

  // --- Demographics -------------------------------------------------------
  /** Age at expected time of delivery, which is what the protocol keys on. */
  ageAtDelivery?: number;
  bmiAtIntake?: number;

  /**
   * The protocol lists this as a pre-eclampsia risk factor and states
   * explicitly that it reflects "underlying social inequity rather than
   * biologic propensity". That framing must travel with the field wherever
   * it is displayed — see the `framing` protocol note on rule `asa-prophylaxis`.
   */
  blackRace?: boolean;
  /** Protocol wording: "lower income". Listed as a moderate risk factor. */
  lowerIncome?: boolean;

  // --- Obstetric history --------------------------------------------------
  gravidity?: number;
  parity?: number;
  nulliparous?: boolean;
  priorPreeclampsia?: boolean;
  priorGestationalHTN?: boolean;
  priorGDM?: boolean;
  priorCesarean?: boolean;
  /** Years since last delivery. Protocol flags >10yr as a moderate risk factor. */
  interpregnancyIntervalYears?: number;
  familyHxPreeclampsia?: boolean;

  priorPretermDelivery?: boolean;
  pretermDeliveryType?: 'medicallyIndicated' | 'spontaneous' | 'cervicalIncompetence';
  /** Protocol: multiple preterm births before 35wks marks high recurrence risk. */
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

  // --- Medical history ----------------------------------------------------
  chronicHypertension?: boolean;
  onAntihypertensives?: boolean;
  bpControl?: 'controlledOffMeds' | 'controlledOnMeds' | 'uncontrolledOnMeds';

  pregestationalDiabetes?: boolean;
  diabetesType?: 'type1' | 'type2';
  gdm?: boolean;
  /** A1 = diet controlled, A2 = medication controlled. */
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
  asthmaPoorlyControlled?: boolean;
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

  /** Rh status drives the 28wk anti-D immune globulin rule. */
  rhNegative?: boolean;

  // --- Social -------------------------------------------------------------
  teenFirstPregnancy?: boolean;
  lowSES?: boolean;
}

/** Field-level labels and the explanatory framing the UI must render inline. */
export const FIELD_FRAMING: Partial<Record<keyof PatientProfile, string>> = {
  blackRace:
    'The protocol lists this as a risk factor "due to underlying social inequity rather than biologic propensity" — not a biologic difference.',
  lowSES:
    'Protocol wording: "low SES". Triggers Nurse Family Partnership referral alongside teen first pregnancy.',
};
