# CATlab CO₂ Monitor

Desktop application for the CO₂ NDIR detector. It replaces `CO2 NDIR Monitor.exe`.
The serial protocol and the conversion formula are documented in [`docs/protocol.md`](../docs/protocol.md).

## Stack

| Part | Technology | Location |
|---|---|---|
| Serial acquisition, storage, calculation, xlsx export | Rust (Tauri 2, `serialport`, SQLite, `rust_xlsxwriter`) | `src-tauri/src` |
| User interface | React, TypeScript, Tailwind, shadcn/ui | `src` |
| Chart | Plotly | `src/components/Chart.tsx` |

## Behaviour

- The application scans all serial ports every 2 s and connects to the first port that replies to the poll request with a valid frame. After a disconnection it scans again.
- Every measurement is written to SQLite as it arrives (`co2-monitor.db` in the application data folder). Measurements outside a run are kept for the retention period in Settings (30 days by default).
- The sample (name, sorbent, gas, flow rate, calculation settings) is configured with Sample before Start. Start then starts the run at once. During a run, Sample edits the run.
- A run is a time interval over the stored measurements. A run that was in progress when the application closed is reopened on the next start.
- Clear chart (outside a run) deletes the measurements on the live chart from the database, except measurements of runs. The chart then starts again at 0 s.
- Manual shows the manual of the CO₂ system (`src/assets/manual.pdf`), rendered with pdf.js. To change the manual, replace the PDF file.
- Charts show time in seconds on the bottom axis and clock time on the top axis. The chart of several runs in History shows seconds only.
- Finish and Abort export the run to an xlsx file in the export folder. An existing file is never overwritten.
- Export in History writes all checked runs to one workbook, one sheet per run. The sheet name is the start date and the sample, for example `2026-10-25_Na-ZY`.
- Each sheet follows the layout and colors of `CO2 capture calculation standard.xlsx`: data in columns A to H, parameters in columns J to N with the chart below them, and soap film times in columns P to R. Columns B (time), C (raw signal), E (Δt) and F (C − baseline) are hidden.
- The workbook has live formulas. `src-tauri/src/calculation.rs` uses the same method, and `src-tauri/examples/export_check.rs` checks that both produce the same results.

## Calculation

The method follows `CO2 capture calculation standard.xlsx`, with these changes:

- Baseline is the minimum of the run, as in the workbook. The baseline cancels out of the capacity: it changes only C/C₀ and the breakthrough time.
- C₀ is the mean over the last C₀ window (default 300 s) minus the baseline, instead of the maximum. The maximum is the highest noise spike and makes the capacity increase with run length.
- Equilibrium is reached when, over the C₀ window, (max − min) / mean is at most the maximum variation in Settings (default 6 %). C₀ is then the mean of a stable window.
- Time steps come from timestamps, keeping the time axis correct when data is missing.
- Optional blank run: its stoichiometric time is subtracted (correction for dead volume).
- Flow rate is the mean of the soap film flow rates, each 60 × volume / time (mL/min). The number of times is free (10 by default).
- Gas law uses R = 0.08206 L·atm/(mol·K) and T + 273.15.
- Flow rate is the mean of the 5 measurements entered at Finish, or the nominal flow rate without measurements.

## Development

Requirements: Node.js 22 or later, Rust, and on Linux the Tauri system libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libudev-dev`).

```bash
npm install
npm run tauri dev        # run with hot reload
npm test                 # frontend unit tests
cd src-tauri && cargo test               # backend unit tests
cd src-tauri && cargo test -- --ignored  # acquisition test with simulator (needs socat, pyserial, typer)
```

### Simulator

`tools/simulator.py` replies to poll requests like the detector and replays a legacy result file. On Linux, create a virtual serial port pair and add the application end to `CO2_EXTRA_PORTS`:

```bash
socat pty,raw,echo=0,link=/tmp/co2-device pty,raw,echo=0,link=/tmp/co2-app &
python3 ../tools/simulator.py /tmp/co2-device --data "../CO2 NDIR Monitor/KQ/Na-ZY (09-11).txt" --step 20 &
CO2_EXTRA_PORTS=/tmp/co2-app npm run tauri dev
```

`tools/e2e.py` runs a complete scenario on the built application (`npx tauri build --debug --no-bundle`) with `tauri-driver` and saves screenshots. It takes about 70 s: the script sets `CO2_POLL_INTERVAL_MS=50`, which makes a debug build poll every 50 ms instead of every second. Release builds ignore this variable. The acquisition integration tests use the same short timing (`Timing::fast`) and take about 3 s.

## Windows build

The GitHub Actions workflow `.github/workflows/build.yml` runs the tests and builds the Windows installers (`.msi` and `.exe`) as the `co2-monitor-windows` artifact. A tag `v<version>` also attaches the installers to a release of that tag.

To build on a Windows computer: install Node.js and Rust, then run `npm install` and `npx tauri build`.
