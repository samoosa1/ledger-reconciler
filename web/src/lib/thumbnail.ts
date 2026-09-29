/**
 * Small first-page renders for the extraction review.
 *
 * A thumbnail answers a question the extracted fields cannot: does this
 * file look like an invoice at all? A sideways scan, a blank page or a
 * cover letter explains a "partial" row at a glance, where the empty
 * cells only say that something went wrong.
 *
 * Renders are serialised through one queue. pdf.js copes with parallel
 * documents, but twenty-five of them decoding at once beside a running
 * OCR pass is exactly the memory spike the sequential pipeline was
 * written to avoid. Results are cached per File so a re-render of the
 * table never decodes a document twice.
 */

import { loadPdfjs } from './pdf'

export interface Thumbnail {
  url: string
  /** CSS pixels, so the <img> can carry explicit dimensions. */
  width: number
  height: number
}

const cache = new WeakMap<Blob, Promise<Thumbnail | null>>()
let queue: Promise<unknown> = Promise.resolve()

/** Page 1 at `widthPx` CSS pixels wide, or null when there is no page to show. */
export function pageThumbnail(file: Blob, widthPx: number): Promise<Thumbnail | null> {
  let hit = cache.get(file)
  if (!hit) {
    hit = new Promise<Thumbnail | null>((resolve) => {
      queue = queue.then(() => render(file, widthPx).then(resolve, () => resolve(null)))
    })
    cache.set(file, hit)
  }
  return hit
}

async function render(file: Blob, widthPx: number): Promise<Thumbnail | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) return null
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: bytes })
  try {
    const doc = await task.promise
    if (doc.numPages < 1) return null
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // Backing store at device resolution, capped at 2x: a 44px thumbnail
    // rendered at 3x is pixels nobody can see.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale: (widthPx * dpr) / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // 'print' for the same reason as the OCR render: display-intent
    // rendering pauses in a background tab.
    await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise
    return {
      url: canvas.toDataURL('image/png'),
      width: widthPx,
      height: Math.round((base.height / base.width) * widthPx),
    }
  } finally {
    await task.destroy()
  }
}
