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

/**
 * The intake board.
 *
 * Hard rule: nothing on this board may move when a selection is made. A
 * control that shifts out from under the pointer defeats the whole point of
 * a tap-first interface. That constraint drives three decisions here:
 *
 *  - Tiles sit in a fixed grid and always reserve two lines, so showing a
 *    sub-value or a caption never changes a tile's size.
 *  - Sub-options and reasoning live in one fixed-height strip above the
 *    board rather than expanding inline.
 *  - Slider captions reserve their line whether or not there is anything
 *    to say.
 */

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

/** Second line on a tile: the chosen sub-value, or framing that must stay visible. */
function tileCaption(p: PatientProfile, t: Tile): string {
  if (!isOn(p, t)) return '';
  if (t.field === 'blackRace') return 'social inequity, not biology';
  if ('sub' in t && t.sub) {
    for (const s of t.sub) {
      const v = p[s.field];
      if (v === undefined) continue;
      if (s.kind === 'choice') {
        return s.options.find((o) => o.value === v)?.label ?? '';
      }
      if (s.kind === 'number') return `${s.label} ${v}`;
    }
  }
  return '';
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  caption,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  suffix: string;
  caption: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <div className="slider-row">
        <b>{label}</b>
        <input
          type="range"
          min={min}
          max={max}
          value={value ?? Math.round((min + max) / 2)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className="slider-val">
          {value ?? '—'}
          <em>{suffix}</em>
        </span>
      </div>
      {/* Reserved whether or not there is a caption, so nothing below moves. */}
      <div className="slider-caption">{caption}</div>
    </div>
  );
}

export function IntakeBoard({ profile, onChange }: Props) {
  const [focused, setFocused] = useState<Key | null>(null);

  const set = (field: Key, value: unknown) =>
    onChange({ ...profile, [field]: value } as PatientProfile);

  const toggle = (tile: Tile) => {
    const on = isOn(profile, tile);
    const next: PatientProfile = { ...profile };
    if (on) {
      const off = TOGGLE_OFF_VALUES[tile.field];
      (next as Record<string, unknown>)[tile.field] = off ?? undefined;
    } else {
      (next as Record<string, unknown>)[tile.field] = TOGGLE_VALUES[tile.field] ?? true;
      if ('sub' in tile && tile.sub) {
        for (const s of tile.sub) {
          if (SUB_DEFAULTS[s.field] !== undefined && next[s.field] === undefined) {
            (next as Record<string, unknown>)[s.field] = SUB_DEFAULTS[s.field];
          }
        }
      }
    }
    setFocused(tile.field);
    onChange(next);
  };

  // Derived pathways, shown as slider captions rather than as a row of chips
  // that appears and disappears.
  let ageCaption = '';
  if (profile.ageAtDelivery !== undefined) {
    if (profile.ageAtDelivery >= 40) ageCaption = 'AMA ≥40 · MFM offer, weekly testing 36wks, IOL 39wks';
    else if (profile.ageAtDelivery >= 35) ageCaption = 'AMA 35–39 · cfDNA offer, IOL 39wks';
  }
  let bmiCaption = '';
  if (profile.bmiAtIntake !== undefined) {
    if (profile.bmiAtIntake >= 40) bmiCaption = 'BMI ≥40 · weekly testing from 34wks';
    else if (profile.bmiAtIntake >= 35) bmiCaption = 'BMI 35–39.9 · weekly testing from 36wks';
    else if (profile.bmiAtIntake > 30) bmiCaption = 'BMI >30 · A1c with initial labs';
  }

  const focusedTile: Tile | undefined = GROUPS.flatMap((g) => g.tiles).find(
    (t) => t.field === focused,
  );
  const info = focused ? FIELD_INFO[focused] : undefined;
  const showSubs = focusedTile && 'sub' in focusedTile && focusedTile.sub && isOn(profile, focusedTile);

  return (
    <div className="pane intake">
      <div className="sliders">
        <Slider
          label="Age"
          value={profile.ageAtDelivery}
          min={13}
          max={50}
          suffix="at delivery"
          caption={ageCaption}
          onChange={(v) => {
            setFocused('ageAtDelivery');
            set('ageAtDelivery', v);
          }}
        />
        <Slider
          label="BMI"
          value={profile.bmiAtIntake}
          min={15}
          max={55}
          suffix="at intake"
          caption={bmiCaption}
          onChange={(v) => {
            setFocused('bmiAtIntake');
            set('bmiAtIntake', v);
          }}
        />
      </div>

      {/* Fixed height. Holds sub-options and reasoning for whatever was last
          touched, so neither ever expands inside the board. */}
      <div className="context">
        {focusedTile || info ? (
          <>
            <div className="context-head">
              <span>{info?.label ?? focusedTile?.label}</span>
              {showSubs &&
                focusedTile!.sub!.map((s) =>
                  s.kind === 'choice' ? (
                    s.options.map((o) => (
                      <button
                        key={o.value}
                        className="opt"
                        aria-pressed={profile[s.field] === o.value}
                        onClick={() => set(s.field, o.value)}
                      >
                        {o.label}
                      </button>
                    ))
                  ) : s.kind === 'number' ? (
                    <span className="opt-num" key={String(s.field)}>
                      {s.label}
                      <input
                        type="range"
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={(profile[s.field] as number) ?? s.min}
                        onChange={(e) => set(s.field, Number(e.target.value))}
                        aria-label={s.label}
                      />
                      <b>{(profile[s.field] as number) ?? '—'}</b>
                    </span>
                  ) : null,
                )}
            </div>
            <p className="context-why">{info?.framing ?? info?.why ?? ''}</p>
          </>
        ) : (
          <p className="context-hint">
            Set dating, age and BMI, then tap what applies. Each selection explains
            itself here.
          </p>
        )}
      </div>

      <div className="board">
        {GROUPS.map((g) => (
          <section className="group" key={g.title}>
            <h3>{g.title}</h3>
            <div className="tiles">
              {g.tiles.map((t) => {
                const on = isOn(profile, t);
                const caption = tileCaption(profile, t);
                return (
                  <button
                    key={String(t.field) + t.label}
                    className={`tile${focused === t.field ? ' focused' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(t)}
                  >
                    <span className="t-label">{t.label}</span>
                    <span className="t-state">{caption}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
