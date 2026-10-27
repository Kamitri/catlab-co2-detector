# CATlab CO₂ Monitor

Desktop application for the CATlab CO₂ NDIR detector. It replaces `CO2 NDIR Monitor.exe`.

## Install

Download the Windows installer from [Releases](../../releases). Builds of other commits are in the `co2-monitor-windows` artifact of the [Build workflow](../../actions/workflows/build.yml).

## Use

1. **Sample**: enter the sample before the purge.
2. **Start**: switch the gas to the sample and press Start.
3. **Finish**: after "Equilibrium reached", enter the soap film times. The run is exported to xlsx.

History shows, edits, exports and deletes runs.

## Development

```bash
cd app
npm ci
npm run tauri dev
```

Details: [`app/README.md`](app/README.md). Detector protocol: [`docs/protocol.md`](docs/protocol.md).

## Release

Push a tag `v<version>`, for example `v1.0.0`. The Build workflow attaches the installers to a release of that tag.

## License

Proprietary, internal use at CATlab. See [LICENSE](LICENSE).
