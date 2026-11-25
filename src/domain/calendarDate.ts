/**
 * Expense dates are plain `YYYY-MM-DD` strings with no time of day, so an
 * expense never shifts day or month with time zones. Because the format is
 * fixed-width, comparing two dates as strings compares them chronologically.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** The local calendar date of `date`, as `YYYY-MM-DD`. */
export function toCalendarDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True for a well-formed `YYYY-MM-DD` that names a real day (no 30 February). */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  // new Date rolls impossible days over (30 Feb → 2 Mar), so a mismatch means not a real day.
  const date = toLocalDate(text)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/** The local `Date` at midnight on a `YYYY-MM-DD` calendar date or the first of a `YYYY-MM` month. */
function toLocalDate(text: string): Date {
  const [year, month, day = 1] = text.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** e.g. "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  return toLocalDate(month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

/** e.g. "2026-11-20" → "20 Nov". */
export function formatExpenseDate(expenseDate: string): string {
  return toLocalDate(expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** The month (`YYYY-MM`) a calendar date belongs to. */
export function monthOf(calendarDate: string): string {
  return calendarDate.slice(0, 7)
}

/** The month `count` months after `month` (`YYYY-MM`); negative counts go back. */
export function addMonths(month: string, count: number): string {
  const date = toLocalDate(month)
  return monthOf(toCalendarDate(new Date(date.getFullYear(), date.getMonth() + count, 1)))
}
