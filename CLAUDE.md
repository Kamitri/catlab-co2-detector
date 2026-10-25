# Project rules

## UI text

- Use the standard word that desktop programs use for each control: File, Open, Save, Export, Settings, Port, Baud rate, Connect, Disconnect, Start, Stop, Clear. Do not substitute synonyms.
- Do not add helper text, subtitles, descriptions under headings, placeholder sentences, or explanatory empty states. A label is enough.
- Write chemical formulas and symbols with real subscripts everywhere text is shown: UI (`<sub>`), Plotly titles (`<sub>`), xlsx (rich text subscript), plain text (CO₂, C₀).
- Each status message reports the event once, for example "Disconnected from COM3". Do not append a reason that repeats the event.
- Use plain labels, not internal jargon ("Missing data", not "Gaps").
- Keep the teal palette defined in `app/src/index.css`; do not return to black and grey.

## UI style

- Forms use `FormGroup`, `FormGrid` and `FormRow` from `app/src/components/FormLayout.tsx`: label on the left, field on the right, fields grouped by topic.
- Numbers use `NumberInput`: right-aligned, unit inside the field, not in the label.
- Controls are 28 px tall (`h-7`) with 13 px text; fields have filled background without border at rest (`FIELD_CLASS`).
- Charts have fixed default axes (`app/src/lib/view.ts`): time 0–5000 s, extended by 1000 s near end; CO₂ 0–40000 ppm. Zoom, pan, and Axes keep user view until Reset view.
