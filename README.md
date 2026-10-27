# CATlab CO₂ Monitor

Desktop application for the CATlab CO₂ NDIR detector. It replaces `CO2 NDIR Monitor.exe`.

## Install

Download the Windows installer from [Releases](../../releases). Builds of other commits are in the `co2-monitor-windows` artifact of the [Build workflow](../../actions/workflows/build.yml).

## Use

1. **Sample**: enter the sample before the purge.
2. **Start**: switch the gas to the sample and press Start.
3. **Finish**: after "Equilibrium reached", enter the soap film times. The run is exported to xlsx.

History shows, edits, reorders, exports and deletes runs.

## Development

```bash
cd app
npm ci
npm run tauri dev
```

Details: [`app/README.md`](app/README.md). Detector protocol: [`docs/protocol.md`](docs/protocol.md).

## Release

1. Set `version` in `app/src-tauri/tauri.conf.json`, for example `1.0.0`.
2. Push a tag with the same version, for example `v1.0.0`.

The Build workflow attaches the installers and `latest.json` to a release of that tag. Installed applications find the release at start and update after confirmation. The workflow signs the installers with the repository secret `TAURI_SIGNING_PRIVATE_KEY`.

## License

Proprietary, internal use at CATlab. See [LICENSE](LICENSE).
