interface Props {
  open: boolean
  onToggle: () => void
  /** Visible word, e.g. "Details". Hidden from assistive tech: the
   * screen-reader label below already says what it opens and for whom. */
  label: string
  srLabel: string
}

/**
 * Opens a row's drill-down. A real button rather than a clickable <tr>:
 * a table row is not focusable, so without this the finding
 * explanations are unreachable by keyboard. Rows may still toggle on
 * click as a convenience for pointer users.
 *
 * This was a bare +/− glyph in a narrow column and readers did not find
 * the drill-down. A labelled control with a control's outline says what
 * it does; the chevron carries the open/closed state a second way.
 */
export function Disclose({ open, onToggle, label, srLabel }: Props) {
  return (
    <button
      type="button"
      className="disclose"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{srLabel}</span>
      <svg className="disclose-chev" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
