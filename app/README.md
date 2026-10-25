# CO₂ Monitor

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
- A run is a time interval over the stored measurements. A run that was in progress when the application closed is reopened on the next start.
- Finish and Abort export the run to an xlsx file in the export folder. An existing file is never overwritten.
- The workbook has live formulas. `src-tauri/src/calculation.rs` uses the same method, and `src-tauri/examples/export_check.rs` checks that both produce the same results.

## Calculation

The method follows `CO2 capture calculation standard.xlsx`, with these changes:

- Baseline is the mean over the first baseline window (default 60 s), instead of the minimum.
- Co is the mean over the last Co window (default 300 s) minus the baseline, instead of the maximum.
- Time steps come from timestamps, keeping the time axis correct when data is missing.
- Optional blank run: its stoichiometric time is subtracted (correction for dead volume).
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

`tools/e2e.py` runs a complete scenario on the built application (`npx tauri build --debug --no-bundle`) with `tauri-driver` and saves screenshots. It takes about 30 s: the script sets `CO2_POLL_INTERVAL_MS=50`, which makes a debug build poll every 50 ms instead of every second. Release builds ignore this variable. The acquisition integration tests use the same short timing (`Timing::fast`) and take about 3 s.

## Windows build

The GitHub Actions workflow `.github/workflows/build.yml` runs the tests and builds the Windows installers (`.msi` and `.exe`). Download them from the `co2-monitor-windows` artifact of the workflow run.

To build on a Windows computer: install Node.js and Rust, then run `npm install` and `npx tauri build`.
