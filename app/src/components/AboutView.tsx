import { getTauriVersion, getVersion } from "@tauri-apps/api/app"
import { openPath, openUrl } from "@tauri-apps/plugin-opener"
import { useEffect, useState } from "react"

import icon from "@/assets/icon.png"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"

const AUTHOR = "Nguyễn Minh Trí"
const EMAIL = "tri@kamitri.com"
const YEAR = 2026

const THIRD_PARTY = [
  ["Tauri", "MIT / Apache-2.0"],
  ["React", "MIT"],
  ["Plotly.js", "MIT"],
  ["shadcn/ui", "MIT"],
  ["Radix UI", "MIT"],
  ["Tailwind CSS", "MIT"],
  ["Geist font", "OFL-1.1"],
  ["SQLite", "Public domain"],
  ["rusqlite", "MIT"],
  ["serialport-rs", "MPL-2.0"],
  ["rust_xlsxwriter", "MIT / Apache-2.0"],
  ["keepawake-rs", "MIT / Apache-2.0"],
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

export function AboutView() {
  const [version, setVersion] = useState("")
  const [tauriVersion, setTauriVersion] = useState("")
  const [dataFolder, setDataFolder] = useState("")

  useEffect(() => {
    void getVersion().then(setVersion)
    void getTauriVersion().then(setTauriVersion)
    void api.dataFolder().then(setDataFolder)
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-xl space-y-6 px-6 py-10">
        <div className="flex items-center gap-4">
          <img src={icon} alt="" className="size-16" draggable={false} />
          <div>
            <h2 className="text-xl font-semibold">
              CO<sub>2</sub> Monitor
            </h2>
            <p className="text-sm text-muted-foreground">Version {version}</p>
          </div>
        </div>
        <Separator />
        <div className="space-y-2">
          <Row label="Made for">CATlab</Row>
          <Row label="Author">{AUTHOR}</Row>
          <Row label="Email">
            <button className="text-primary hover:underline" onClick={() => void openUrl(`mailto:${EMAIL}`)}>
              {EMAIL}
            </button>
          </Row>
          <Row label="Tauri">{tauriVersion}</Row>
          <Row label="Data folder">
            <span className="flex items-center gap-2">
              <span className="truncate font-mono text-xs">{dataFolder}</span>
              {dataFolder && (
                <Button size="xs" variant="outline" onClick={() => void openPath(dataFolder)}>
                  Open
                </Button>
              )}
            </span>
          </Row>
        </div>
        <Separator />
        <div className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Third-party software</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {THIRD_PARTY.map(([name, license]) => (
              <div key={name} className="flex justify-between gap-4">
                <span>{name}</span>
                <span className="text-muted-foreground">{license}</span>
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <p className="text-sm text-muted-foreground">
          © {YEAR} {AUTHOR}. All rights reserved.
        </p>
      </div>
    </div>
  )
}
