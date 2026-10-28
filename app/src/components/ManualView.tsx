import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
  TextLayer,
} from "pdfjs-dist/legacy/build/pdf.mjs"
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import manualUrl from "@/assets/manual.pdf?url"

// Legacy build of pdf.js: runs in WebKitGTK of Linux as well as WebView2 of Windows
GlobalWorkerOptions.workerSrc = workerUrl

/** Page width at most this (CSS px); in narrower window, page fits window. */
const MAX_PAGE_WIDTH = 900
/** Horizontal space around page (CSS px). */
const PAGE_MARGIN = 48
/** Height of page before first render, as fraction of width (A4). */
const A4_RATIO = 297 / 210

// Manual is loaded once; switching tabs keeps loaded document
let manual: Promise<PDFDocumentProxy> | null = null

function loadManual(): Promise<PDFDocumentProxy> {
  manual ??= getDocument({ url: manualUrl }).promise
  return manual
}

/** Manual of CO₂ system (PDF), one page below another; text can be selected and copied. */
export function ManualView() {
  const viewport = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    void loadManual().then(setDocument)
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(0, Math.min(MAX_PAGE_WIDTH, element.clientWidth - PAGE_MARGIN))),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={viewport} className="min-h-0 flex-1 overflow-auto bg-muted/40">
      <div className="flex flex-col items-center gap-4 py-6">
        {document &&
          width > 0 &&
          Array.from({ length: document.numPages }, (_, index) => (
            <ManualPage key={index} document={document} number={index + 1} width={width} />
          ))}
      </div>
    </div>
  )
}

function ManualPage({ document, number, width }: { document: PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(width * A4_RATIO)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null
    let layer: TextLayer | null = null
    void document.getPage(number).then((page) => {
      const element = canvas.current
      const container = text.current
      if (cancelled || !element || !container) return
      const pageScale = width / page.getViewport({ scale: 1 }).width
      const view = page.getViewport({ scale: pageScale })
      setHeight(view.height)
      setScale(pageScale)
      // Canvas pixels at screen resolution keep text sharp on high-DPI screens
      const ratio = window.devicePixelRatio || 1
      element.width = Math.floor(view.width * ratio)
      element.height = Math.floor(view.height * ratio)
      task = page.render({ canvas: element, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] })
      // Cancelled render rejects; next render replaces it
      task.promise.catch(() => undefined)
      container.replaceChildren()
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport: view })
      layer.render().catch(() => undefined)
    })
    return () => {
      cancelled = true
      task?.cancel()
      layer?.cancel()
    }
  }, [document, number, width])

  return (
    <div
      className="relative shrink-0 bg-white shadow-sm"
      style={
        {
          width,
          height,
          // Text layer of pdf.js sizes text with these variables
          "--scale-factor": scale,
          "--user-unit": 1,
          "--total-scale-factor": scale,
        } as React.CSSProperties
      }
      data-page={number}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div ref={text} className="textLayer" />
    </div>
  )
}
