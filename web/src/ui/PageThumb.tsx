import { useEffect, useState } from 'react'
import { pageThumbnail, type Thumbnail } from '../lib/thumbnail'

/** A4 proportions at this width. The box is fixed so rows never jump
 * when a render lands; a landscape page sits centred inside it. */
export const THUMB_WIDTH = 44
export const THUMB_HEIGHT = 62

interface Props {
  file: Blob
  name: string
}

/**
 * First page of an invoice, small. Undefined while rendering, null when
 * the file has no page to show (empty or corrupt), which is the same
 * case the pipeline reports as failed.
 */
export function PageThumb({ file, name }: Props) {
  const [thumb, setThumb] = useState<Thumbnail | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    void pageThumbnail(file, THUMB_WIDTH).then((t) => {
      if (live) setThumb(t)
    })
    return () => {
      live = false
    }
  }, [file])

  return (
    <span className="thumb" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
      {thumb ? (
        <img
          src={thumb.url}
          width={thumb.width}
          height={thumb.height}
          alt={`First page of ${name}`}
          decoding="async"
        />
      ) : (
        <span className="sr-only">
          {thumb === null ? `No preview for ${name}` : `Rendering preview of ${name}…`}
        </span>
      )}
    </span>
  )
}
