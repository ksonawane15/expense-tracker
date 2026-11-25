/**
 * The schema and migration module. Every data blob the app reads, whether an
 * import file or stored data (ADR-0001), goes through here: its schema version
 * is checked, it is upgraded step by step to the current schema, and then it
 * is validated in full. Nothing invalid gets past, and nothing throws.
 */
import { isCalendarDate } from './calendarDate.ts'
import { MAX_AMOUNT } from './money.ts'
import { OTHER_CATEGORY_ID, SCHEMA_VERSION, type Category, type Expense, type TrackerData } from './types.ts'

/** Either the data, checked and upgraded to the current schema, or why it was refused. */
export type SchemaResult = { ok: true; data: TrackerData } | { ok: false; message: string }

export interface ReadOptions {
  /** Today's local calendar date, `YYYY-MM-DD`; expense dates after it are refused. */
  today: string
}

/**
 * `migrations[n]` upgrades a version-n blob to version n + 1. It may assume
 * the blob is a plain object but nothing else: the result is validated after
 * the last step. Changing the data shape means bumping SCHEMA_VERSION, adding
 * the migration from the old version here, and adding a fixture file for the
 * old version (in ./fixtures) with a test that imports it.
 */
const migrations: Record<number, (blob: Record<string, unknown>) => Record<string, unknown>> = {}

/**
 * Checks a parsed data blob from any source (an import file or stored data),
 * upgrades it to the current schema, and validates it in full. Fields the
 * schema doesn't define are dropped.
 */
export function readTrackerData(blob: unknown, { today }: ReadOptions): SchemaResult {
  if (!isObject(blob)) return refuse('The data is not expense tracker data.')

  const version = blob.schemaVersion
  if (version === undefined) return refuse('The data has no schema version.')
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return refuse(`The data has an unknown schema version (${JSON.stringify(version)}).`)
  }
  if (version > SCHEMA_VERSION) {
    return refuse(
      `The data has schema version ${version}, which is newer than this app understands (version ${SCHEMA_VERSION}).`,
    )
  }

  let upgraded = blob
  for (let from = version; from < SCHEMA_VERSION; from++) {
    upgraded = migrations[from]({ ...upgraded, schemaVersion: from })
  }
  return validate(upgraded, today)
}

/** `readTrackerData` for JSON text, refusing text that isn't JSON. */
export function readTrackerJson(text: string, options: ReadOptions): SchemaResult {
  let blob: unknown
  try {
    blob = JSON.parse(text)
  } catch {
    return refuse('The data is not valid JSON.')
  }
  return readTrackerData(blob, options)
}

/** Validates a blob already upgraded to the current schema, keeping only known fields. */
function validate(blob: Record<string, unknown>, today: string): SchemaResult {
  if (!Array.isArray(blob.categories)) return refuse('The data has no list of categories.')
  if (!Array.isArray(blob.expenses)) return refuse('The data has no list of expenses.')

  const categories: Category[] = []
  const categoryIds = new Set<string>()
  const categoryNames = new Map<string, string>()
  for (const [index, raw] of blob.categories.entries()) {
    const where = `Category ${index + 1}`
    if (!isObject(raw)) return refuse(`${where} is not a category.`)
    const { id, name } = raw
    if (!isNonBlankString(id)) return refuse(`${where} has no id.`)
    if (!isNonBlankString(name)) return refuse(`${where} has no name.`)
    if (categoryIds.has(id)) return refuse(`More than one category share the id "${id}".`)
    // Names are unique ignoring case and surrounding whitespace.
    const nameKey = name.trim().toLowerCase()
    const sameName = categoryNames.get(nameKey)
    if (sameName !== undefined) return refuse(`There is more than one category named "${sameName}".`)
    categoryIds.add(id)
    categoryNames.set(nameKey, name.trim())
    categories.push({ id, name })
  }
  if (!categoryIds.has(OTHER_CATEGORY_ID)) return refuse('The data has no Other category.')

  const expenses: Expense[] = []
  const expenseIds = new Set<string>()
  for (const [index, raw] of blob.expenses.entries()) {
    const where = `Expense ${index + 1}`
    if (!isObject(raw)) return refuse(`${where} is not an expense.`)
    const { id, amount, description, expenseDate, categoryId } = raw
    if (!isNonBlankString(id)) return refuse(`${where} has no id.`)
    if (expenseIds.has(id)) return refuse(`More than one expense share the id "${id}".`)
    expenseIds.add(id)
    if (amount === undefined) return refuse(`${where} has no amount.`)
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return refuse(`${where} has an amount that is not a whole number of paise.`)
    }
    if (amount <= 0) return refuse(`${where} has an amount that is not more than zero.`)
    if (amount > MAX_AMOUNT) return refuse(`${where} has an amount above ₹1,00,00,000.`)
    if (!isNonBlankString(description)) return refuse(`${where} has no description.`)
    if (expenseDate === undefined) return refuse(`${where} has no expense date.`)
    if (typeof expenseDate !== 'string' || !isCalendarDate(expenseDate)) {
      return refuse(`${where} has an expense date that is not a valid YYYY-MM-DD calendar day.`)
    }
    if (expenseDate > today) return refuse(`${where} has an expense date in the future (${expenseDate}).`)
    if (!isNonBlankString(categoryId)) return refuse(`${where} has no category.`)
    if (!categoryIds.has(categoryId)) return refuse(`${where} points at a category that does not exist ("${categoryId}").`)
    expenses.push({ id, amount, description, expenseDate, categoryId })
  }

  return { ok: true, data: { schemaVersion: SCHEMA_VERSION, categories, expenses } }
}

function refuse(message: string): SchemaResult {
  return { ok: false, message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
