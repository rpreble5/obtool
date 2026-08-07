# OB Care Planner — prototype

Interactive antenatal care planning for family medicine residents, built from the
FMC OB Patient Care protocol (5_2022, edit 4/23).

**Prototype only. Not for clinical use.** No patient data leaves the browser —
there is no backend and nothing is stored.

## Run

```
npm install
npm run dev
```

## How it is put together

    src/protocol/types.ts    schema — GA in weeks+days, condition language, rules
    src/protocol/rules.ts    the protocol as data (69 rules)
    src/protocol/patient.ts  intake fields, each with the reasoning for asking
    src/protocol/engine.ts   evaluation, suppression, tiering, conflict detection
    src/ui/                  intake board, consolidated plan, timeline

The protocol lives in data, never in application logic. Rules can be updated
without touching code, and every plan item cites the section it came from.

Three principles the code enforces:

- **Every item carries reasoning.** `rationale` is a required field on `Rule`.
- **Conflicts are surfaced, never resolved.** Overlapping delivery windows are
  all shown with their indications; the tightest is marked, not chosen.
- **Additions are marked.** Anything not traceable to the FMC document has
  `source.origin: 'standardGuidance'` and is labelled in the UI.
