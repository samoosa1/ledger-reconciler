import { expect, test } from 'vitest'
import { daysBetween, parseDate, toISO } from '../src/domain/dates'

test('parses all four formats the Python version accepts', () => {
  expect(parseDate('2025-01-15')).toEqual({ year: 2025, month: 1, day: 15 })
  expect(parseDate('2025/01/15')).toEqual({ year: 2025, month: 1, day: 15 })
  expect(parseDate('January 15, 2025')).toEqual({ year: 2025, month: 1, day: 15 })
  expect(parseDate('January 15 2025')).toEqual({ year: 2025, month: 1, day: 15 })
})

/**
 * The hazard this module exists for. With JS `Date`, "2025-01-15" parses as
 * UTC midnight and "January 15, 2025" as LOCAL midnight, so west of UTC the
 * two disagree by a day. Here they must be identical records regardless of
 * where the browser is.
 */
test('the same calendar day is identical across formats, no timezone drift', () => {
  const iso = parseDate('2025-01-15')!
  const prose = parseDate('January 15, 2025')!
  const slash = parseDate('2025/01/15')!
  expect(prose).toEqual(iso)
  expect(slash).toEqual(iso)
  expect(daysBetween(prose, iso)).toBe(0)
})

test('month names are case insensitive', () => {
  expect(parseDate('JANUARY 15, 2025')).toEqual({ year: 2025, month: 1, day: 15 })
  expect(parseDate('january 15, 2025')).toEqual({ year: 2025, month: 1, day: 15 })
})

test('rejects days that do not exist, as strptime does', () => {
  expect(parseDate('2025-02-30')).toBeNull()
  expect(parseDate('2025-13-01')).toBeNull()
  expect(parseDate('2025-00-10')).toBeNull()
  expect(parseDate('Febuary 3, 2025')).toBeNull() // misspelled month
})

test('accepts real leap days and rejects fake ones', () => {
  expect(parseDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
  expect(parseDate('2025-02-29')).toBeNull()
})

test('returns null on unsupported formats rather than guessing', () => {
  expect(parseDate('15/01/2025')).toBeNull()
  expect(parseDate('not a date')).toBeNull()
  expect(parseDate('')).toBeNull()
})

test('daysBetween is signed and crosses month and year boundaries', () => {
  const a = parseDate('2025-01-15')!
  expect(daysBetween(parseDate('2025-01-20')!, a)).toBe(5)
  expect(daysBetween(parseDate('2025-01-10')!, a)).toBe(-5)
  expect(daysBetween(parseDate('2025-02-01')!, a)).toBe(17)
  expect(daysBetween(parseDate('2026-01-15')!, a)).toBe(365)
  // across the DST boundary, where a naive Date-based diff drifts by an hour
  expect(daysBetween(parseDate('2025-03-31')!, parseDate('2025-03-29')!)).toBe(2)
})

test('toISO round-trips', () => {
  for (const s of ['2025-01-15', '2024-02-29', '2025-12-31']) {
    expect(toISO(parseDate(s)!)).toBe(s)
  }
})
