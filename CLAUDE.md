# Project rules

## UI text

- Use the standard word that desktop programs use for each control: File, Open, Save, Export, Settings, Port, Baud rate, Connect, Disconnect, Start, Stop, Clear. Do not substitute synonyms.
- Do not add helper text, subtitles, descriptions under headings, placeholder sentences, or explanatory empty states. A label is enough.
- Write chemical formulas and symbols with real subscripts everywhere text is shown: UI (`<sub>`), Plotly titles (`<sub>`), xlsx (rich text subscript), plain text (CO₂, C₀).
- Status messages name the event once, for example "Disconnected from COM3". Do not append a reason that repeats the event.
- Use plain labels, not internal jargon ("Missing data", not "Gaps").
- Keep the teal palette defined in `app/src/index.css`; do not return to black and grey.
