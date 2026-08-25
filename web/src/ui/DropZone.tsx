import { useCallback, useRef, useState } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  onTrySample: () => void
  busy: boolean
}

/**
 * One drop target, not two. Files are sorted by extension downstream,
 * because sorting for the user beats making them read labels and aim.
 */
export function DropZone({ onFiles, onTrySample, busy }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      if (busy) return
      onFiles([...e.dataTransfer.files])
    },
    [onFiles, busy],
  )

  return (
    <div className="drop-wrap">
      <div
        className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xlsm,.xls,.csv"
          hidden
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])])
            // Reset so re-selecting the same files fires change again.
            e.target.value = ''
          }}
        />
        <div className="drop-title">Drop invoices and your ledger here</div>
        <div className="drop-sub">
          PDF invoices plus one spreadsheet (.xlsx or .csv), or click to browse
        </div>
      </div>

      <div className="drop-alt">
        <span>No files to hand?</span>
        <button type="button" className="link-btn" onClick={onTrySample} disabled={busy}>
          Try it with sample data
        </button>
      </div>
    </div>
  )
}
