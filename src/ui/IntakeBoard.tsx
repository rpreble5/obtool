import { useState } from 'react';
import type { PatientProfile } from '../protocol/patient';
import { FIELD_INFO } from '../protocol/patient';
import {
  GROUPS,
  SUB_DEFAULTS,
  TOGGLE_OFF_VALUES,
  TOGGLE_VALUES,
  type Tile,
} from './intakeConfig';

interface Props {
  profile: PatientProfile;
  onChange: (next: PatientProfile) => void;
}

type Key = keyof PatientProfile;

const isOn = (p: PatientProfile, t: Tile): boolean => {
  const v = p[t.field];
  if (v === undefined || v === null) return false;
  const onValue = TOGGLE_VALUES[t.field];
  if (onValue !== undefined) return v === onValue;
  return v !== false;
};

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const v = value ?? min;
  return (
    <div className="stepper">
      <b>{label}</b>
      <button onClick={() => onChange(Math.max(min, v - step))} aria-label={`Decrease ${label}`}>
        −
      </button>
      <span className="val">{value ?? '—'}</span>
      <button onClick={() => onChange(Math.min(max, v + step))} aria-label={`Increase ${label}`}>
        +
      </button>
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function IntakeBoard({ profile, onChange }: Props) {
  const [lastTouched, setLastTouched] = useState<Key | null>(null);

  const set = (field: Key, value: unknown) => {
    setLastTouched(field);
    onChange({ ...profile, [field]: value } as PatientProfile);
  };

  const toggle = (tile: Tile) => {
    const on = isOn(profile, tile);
    const next: PatientProfile = { ...profile };
    if (on) {
      const off = TOGGLE_OFF_VALUES[tile.field];
      (next as Record<string, unknown>)[tile.field] = off ?? undefined;
    } else {
      (next as Record<string, unknown>)[tile.field] =
        TOGGLE_VALUES[tile.field] ?? true;
      // Apply defaults for any sub-fields so the plan is complete on one tap.
      if ('sub' in tile && tile.sub) {
        for (const s of tile.sub) {
          if (SUB_DEFAULTS[s.field] !== undefined && next[s.field] === undefined) {
            (next as Record<string, unknown>)[s.field] = SUB_DEFAULTS[s.field];
          }
        }
      }
    }
    setLastTouched(tile.field);
    onChange(next);
  };

  // Reasoning shown inline: the field just touched, plus any active field
  // whose framing must always travel with it.
  const whyFields: Key[] = [];
  if (lastTouched && FIELD_INFO[lastTouched]) whyFields.push(lastTouched);
  for (const g of GROUPS) {
    for (const t of g.tiles) {
      if (FIELD_INFO[t.field]?.framing && isOn(profile, t) && !whyFields.includes(t.field)) {
        whyFields.push(t.field);
      }
    }
  }

  const derived: string[] = [];
  if (profile.ageAtDelivery !== undefined) {
    if (profile.ageAtDelivery >= 40) derived.push('AMA ≥40 — MFM offer, weekly testing 36wks, IOL 39wks');
    else if (profile.ageAtDelivery >= 35) derived.push('AMA 35–39 — cfDNA offer, IOL 39wks');
  }
  if (profile.bmiAtIntake !== undefined) {
    if (profile.bmiAtIntake >= 40) derived.push('BMI ≥40 — weekly testing from 34wks');
    else if (profile.bmiAtIntake >= 35) derived.push('BMI 35–39.9 — weekly testing from 36wks');
    else if (profile.bmiAtIntake > 30) derived.push('BMI >30 — A1c with initial labs');
  }

  return (
    <div className="pane">
      <p className="pane-title">Patient</p>

      <div className="measures">
        <Stepper
          label="Age"
          value={profile.ageAtDelivery}
          unit="at delivery"
          step={1}
          min={13}
          max={55}
          onChange={(v) => set('ageAtDelivery', v)}
        />
        <Stepper
          label="BMI"
          value={profile.bmiAtIntake}
          unit="at intake"
          step={1}
          min={15}
          max={60}
          onChange={(v) => set('bmiAtIntake', v)}
        />
      </div>

      {derived.length > 0 && (
        <div className="derived">
          {derived.map((d) => (
            <span className="derived-chip" key={d}>
              auto · {d}
            </span>
          ))}
        </div>
      )}

      {whyFields.map((f) => {
        const info = FIELD_INFO[f]!;
        return (
          <div className="field-why" key={f}>
            <em>{info.label}.</em> {info.framing ?? info.why}
          </div>
        );
      })}

      {GROUPS.map((g) => (
        <section className="group" key={g.title}>
          <h3>{g.title}</h3>
          <div className="tiles">
            {g.tiles.map((t) => (
              <button
                key={String(t.field) + t.label}
                className="tile"
                aria-pressed={isOn(profile, t)}
                onClick={() => toggle(t)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {g.tiles.map((t) => {
            if (!('sub' in t) || !t.sub || !isOn(profile, t)) return null;
            return t.sub.map((s) => (
              <div className="subrow" key={String(s.field)}>
                <b>{s.label}</b>
                {s.kind === 'choice' &&
                  s.options.map((o) => (
                    <button
                      key={o.value}
                      className="opt"
                      aria-pressed={profile[s.field] === o.value}
                      onClick={() => set(s.field, o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                {s.kind === 'number' && (
                  <Stepper
                    label=""
                    value={profile[s.field] as number | undefined}
                    step={s.step}
                    min={s.min}
                    max={s.max}
                    onChange={(v) => set(s.field, v)}
                  />
                )}
              </div>
            ));
          })}
        </section>
      ))}
    </div>
  );
}
