/**
 * Timezone-free dates.
 *
 * The Python original uses `datetime.date`, which has no timezone at all.
 * JavaScript's `Date` does, and worse, it is inconsistent about it:
 *
 *   new Date("2025-01-15")        -> UTC midnight
 *   new Date("January 15, 2025")  -> LOCAL midnight
 *
 * Mixing those two across the supported formats produces off-by-one-day
 * errors that only show up in some timezones, which is the worst kind of
 * bug: invisible where it was written, wrong where it runs. So the domain
 * layer never touches `Date` and works on a plain {year, month, day}
 * record instead. `Date.UTC` appears exactly once, to turn a record into a
 * day number for differencing, where it is timezone-independent by
 * definition.
 */

export interface PlainDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** Rejects days that don't exist in that month, as strptime does. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function make(year: number, month: number, day: number): PlainDate | null {
  return isRealDate(year, month, day) ? { year, month, day } : null
}

/**
 * Parses the four formats the Python version accepts:
 *   %Y-%m-%d   2025-01-15
 *   %B %d, %Y  January 15, 2025
 *   %B %d %Y   January 15 2025
 *   %Y/%m/%d   2025/01/15
 * Returns null on anything else, matching strptime raising ValueError.
 */
export function parseDate(raw: string): PlainDate | null {
  const text = raw.trim()

  const numeric = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(text)
  if (numeric) {
    return make(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]))
  }

  const prose = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(text)
  if (prose) {
    const monthIndex = MONTHS.indexOf(prose[1].toLowerCase())
    if (monthIndex === -1) return null
    return make(Number(prose[3]), monthIndex + 1, Number(prose[2]))
  }

  return null
}

/** Signed difference in whole days, a - b. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  const MS_PER_DAY = 86_400_000
  const at = Date.UTC(a.year, a.month - 1, a.day)
  const bt = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((at - bt) / MS_PER_DAY)
}

/** ISO 8601 date string, for display and report output. */
export function toISO(d: PlainDate): string {
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}
