// Copies installers of release build to release/ with names without spaces, and writes updater manifest latest.json.
// Usage (in app/, after `tauri build` with signing key): node scripts/release-files.mjs v<version>
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"

const tag = process.argv[2]
const repository = process.env.GITHUB_REPOSITORY ?? "Kamitri/catlab-co2-detector"
const { version } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match version ${version} in tauri.conf.json`)

// GitHub replaces spaces in names of release files; names without spaces keep URLs predictable
const releaseName = (file) => file.replaceAll(" ", "-")
const bundle = "src-tauri/target/release/bundle"
mkdirSync("release", { recursive: true })
for (const [folder, extension] of [
  ["msi", ".msi"],
  ["nsis", ".exe"],
]) {
  for (const file of readdirSync(`${bundle}/${folder}`).filter((name) => name.endsWith(extension))) {
    copyFileSync(`${bundle}/${folder}/${file}`, `release/${releaseName(file)}`)
  }
}

// Updater of installed application looks for windows-x86_64-<installer type> first: application installed
// with MSI updates with MSI, application installed with setup updates with setup. Entry without installer
// type is for versions that do not report installer type. Signatures come from build with TAURI_SIGNING_PRIVATE_KEY.
const platform = (folder, extension) => {
  const file = readdirSync(`${bundle}/${folder}`).find((name) => name.endsWith(extension))
  if (!file) throw new Error(`${extension} installer not found`)
  return {
    signature: readFileSync(`${bundle}/${folder}/${file}.sig`, "utf8").trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${releaseName(file)}`,
  }
}
const setup = platform("nsis", "-setup.exe")
const manifest = {
  version,
  notes: `CATlab CO₂ Monitor ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": setup,
    "windows-x86_64-nsis": setup,
    "windows-x86_64-msi": platform("msi", ".msi"),
  },
}
writeFileSync("release/latest.json", `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Release files for ${tag}:`, readdirSync("release"))
