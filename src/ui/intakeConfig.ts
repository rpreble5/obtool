import type { PatientProfile } from '../protocol/patient';

/**
 * The intake board.
 *
 * Every entry here is a tap target. Nothing on this board requires a keyboard
 * except the LMP date (a picker) and the few numeric values that only appear
 * once their parent condition is active.
 *
 * Tiles never move between sessions — position is how a resident finds things
 * quickly on the twentieth use, which is something a search box cannot give.
 */

export type Tile =
  /** Boolean. Tap on, tap off. */
  | { kind: 'toggle'; field: keyof PatientProfile; label: string; sub?: Tile[] }
  /** Small enum. Options appear only once the parent tile is active. */
  | {
      kind: 'choice';
      field: keyof PatientProfile;
      label: string;
      options: { value: string; label: string }[];
    }
  /** Numeric, entered with steppers. Only used inside `sub`. */
  | { kind: 'number'; field: keyof PatientProfile; label: string; step: number; min: number; max: number };

export interface TileGroup {
  title: string;
  tiles: Tile[];
}

export const GROUPS: TileGroup[] = [
  {
    title: 'Obstetric history',
    tiles: [
      { kind: 'toggle', field: 'nulliparous', label: 'Nulliparous' },
      { kind: 'toggle', field: 'priorCesarean', label: 'Prior C-section' },
      {
        kind: 'toggle',
        field: 'priorPretermDelivery',
        label: 'Prior preterm birth',
        sub: [
          {
            kind: 'choice',
            field: 'pretermDeliveryType',
            label: 'Cause',
            options: [
              { value: 'spontaneous', label: 'Spontaneous' },
              { value: 'medicallyIndicated', label: 'Medically indicated' },
              { value: 'cervicalIncompetence', label: 'Cervical incompetence' },
            ],
          },
        ],
      },
      { kind: 'toggle', field: 'priorPreeclampsia', label: 'Prior pre-eclampsia' },
      { kind: 'toggle', field: 'priorGestationalHTN', label: 'Prior gestational HTN' },
      {
        kind: 'toggle',
        field: 'priorFetalDemiseAfter20wks',
        label: 'Prior demise >20wks',
        sub: [
          { kind: 'number', field: 'gaOfPriorDemiseWeeks', label: 'GA of loss (wks)', step: 1, min: 20, max: 42 },
        ],
      },
      { kind: 'toggle', field: 'familyHxPreeclampsia', label: 'Family hx pre-eclampsia' },
      { kind: 'toggle', field: 'interpregnancyIntervalYears', label: 'Interval >10 yrs' },
    ],
  },
  {
    title: 'This pregnancy',
    tiles: [
      { kind: 'toggle', field: 'plurality', label: 'Multiple gestation' },
      { kind: 'toggle', field: 'presentation', label: 'Breech' },
      { kind: 'toggle', field: 'placentaPrevia', label: 'Placenta previa' },
      { kind: 'toggle', field: 'anteriorPlacenta', label: 'Anterior placenta' },
      {
        kind: 'toggle',
        field: 'cervicalLengthMm',
        label: 'Short cervix <2.5cm',
      },
      {
        kind: 'toggle',
        field: 'efwPercentile',
        label: 'Growth abnormality',
        sub: [
          { kind: 'number', field: 'efwPercentile', label: 'EFW centile', step: 1, min: 1, max: 99 },
        ],
      },
      { kind: 'toggle', field: 'rhNegative', label: 'Rh negative' },
      { kind: 'toggle', field: 'positiveAntibodyScreen', label: 'Positive antibody' },
    ],
  },
  {
    title: 'Cardiometabolic',
    tiles: [
      {
        kind: 'toggle',
        field: 'chronicHypertension',
        label: 'Chronic hypertension',
        sub: [
          {
            kind: 'choice',
            field: 'bpControl',
            label: 'Control',
            options: [
              { value: 'controlledOnMeds', label: 'Controlled on meds' },
              { value: 'controlledOffMeds', label: 'Controlled, no meds' },
              { value: 'uncontrolledOnMeds', label: 'Uncontrolled on meds' },
            ],
          },
        ],
      },
      {
        kind: 'toggle',
        field: 'gdm',
        label: 'Gestational diabetes',
        sub: [
          {
            kind: 'choice',
            field: 'gdmClass',
            label: 'Class',
            options: [
              { value: 'A1', label: 'A1 — diet' },
              { value: 'A2', label: 'A2 — medication' },
            ],
          },
        ],
      },
      {
        kind: 'toggle',
        field: 'pregestationalDiabetes',
        label: 'Pre-existing diabetes',
        sub: [
          {
            kind: 'choice',
            field: 'diabetesType',
            label: 'Type',
            options: [
              { value: 'type2', label: 'Type 2' },
              { value: 'type1', label: 'Type 1' },
            ],
          },
        ],
      },
      { kind: 'toggle', field: 'bariatricSurgery', label: 'Bariatric surgery' },
    ],
  },
  {
    title: 'Other medical',
    tiles: [
      { kind: 'toggle', field: 'hypothyroid', label: 'Hypothyroid' },
      { kind: 'toggle', field: 'hyperthyroid', label: 'Hyperthyroid' },
      {
        kind: 'toggle',
        field: 'cholestasis',
        label: 'Cholestasis',
        sub: [
          { kind: 'number', field: 'bileAcidLevel', label: 'Bile acids', step: 10, min: 0, max: 300 },
        ],
      },
      { kind: 'toggle', field: 'genitalHSV', label: 'Genital HSV' },
      { kind: 'toggle', field: 'recurrentPositiveUrineCulture', label: 'Recurrent +Ucx' },
      { kind: 'toggle', field: 'pyelonephritisThisPregnancy', label: 'Pyelonephritis' },
      { kind: 'toggle', field: 'activeDepressionOrAnxietyOnMeds', label: 'Depression/anxiety on meds' },
      { kind: 'toggle', field: 'covidInfectionThisPregnancy', label: 'COVID this pregnancy' },
    ],
  },
  {
    title: 'Refer to MFM',
    tiles: [
      { kind: 'toggle', field: 'renalDisease', label: 'Renal disease' },
      { kind: 'toggle', field: 'heartDisease', label: 'Heart disease' },
      { kind: 'toggle', field: 'lungDisease', label: 'Lung disease' },
      { kind: 'toggle', field: 'autoimmuneDisease', label: 'Autoimmune / lupus' },
      { kind: 'toggle', field: 'seizureDisorder', label: 'Seizure disorder' },
      { kind: 'toggle', field: 'clottingDisorder', label: 'Clotting disorder' },
      { kind: 'toggle', field: 'activeDvtOrPe', label: 'Active DVT / PE' },
      { kind: 'toggle', field: 'hiv', label: 'HIV' },
      { kind: 'toggle', field: 'chronicHepatitis', label: 'Chronic hepatitis' },
      { kind: 'toggle', field: 'activeSyphilis', label: 'Active syphilis' },
      { kind: 'toggle', field: 'tuberculosis', label: 'Tuberculosis' },
    ],
  },
  {
    title: 'Social',
    tiles: [
      { kind: 'toggle', field: 'lowerIncome', label: 'Lower income' },
      { kind: 'toggle', field: 'blackRace', label: 'Black race' },
      { kind: 'toggle', field: 'teenFirstPregnancy', label: 'Teen first pregnancy' },
      { kind: 'toggle', field: 'lowSES', label: 'Low SES' },
      { kind: 'toggle', field: 'tobaccoUse', label: 'Tobacco use' },
    ],
  },
];

/**
 * Fields whose "on" value is not simply `true`. Tapping the tile writes the
 * value on the right, so the resident never picks a value for something the
 * tile label already states.
 */
export const TOGGLE_VALUES: Partial<Record<keyof PatientProfile, unknown>> = {
  plurality: 'multiple',
  presentation: 'breech',
  cervicalLengthMm: 20,
  efwPercentile: 95,
  interpregnancyIntervalYears: 11,
};

export const TOGGLE_OFF_VALUES: Partial<Record<keyof PatientProfile, unknown>> = {
  plurality: 'singleton',
  presentation: 'vertex',
};

/** Defaults applied when a parent tile is switched on, so nothing needs a second tap. */
export const SUB_DEFAULTS: Partial<Record<keyof PatientProfile, unknown>> = {
  pretermDeliveryType: 'spontaneous',
  bpControl: 'controlledOnMeds',
  gdmClass: 'A2',
  diabetesType: 'type2',
  bileAcidLevel: 50,
  efwPercentile: 95,
  gaOfPriorDemiseWeeks: 32,
};
