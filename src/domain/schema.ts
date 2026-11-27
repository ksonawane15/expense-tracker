/**
 * The schema and migration module. Every data blob the app reads, whether an
 * import file, stored records or v1 data being upgraded, goes through here:
 * its schema version is checked, it is upgraded step by step to the current
 * schema, and then it is validated in full. Nothing invalid gets past, and
 * nothing throws.
 */
import { isCalendarDate } from './calendarDate.ts'
import { formatAmount, MAX_AMOUNT } from './money.ts'
import {
  byCreation,
  categoryNameKey,
  OTHER_CATEGORY_ID,
  SCHEMA_VERSION,
  type Category,
  type Expense,
  type SyncFields,
  type TrackerData,
} from './types.ts'

/** Either the data, checked and upgraded to the current schema, or why it was refused. */
export type SchemaResult = { ok: true; data: TrackerData } | { ok: false; message: string }

export interface ReadOptions {
  /**
   * Today's local calendar date, `YYYY-MM-DD`; expense dates after it are
   * refused. Given for import files. Left out for stored data, which the app
   * saved itself and which must not become unreadable just because the clock
   * or time zone has moved back.
   */
  today?: string
  /** When the data is being read: records upgraded from v1 get their times from it. */
  now: Date
}

type Blob = Record<string, unknown>

/**
 * `migrations[n]` upgrades a version-n blob to version n + 1. It may assume
 * the blob is a plain object but nothing else: the result is validated after
 * the last step. Changing the data shape after a schema version is released
 * means bumping SCHEMA_VERSION, adding the migration from the old version
 * here, and adding a fixture file for the old version (in ./fixtures) with a
 * test that imports it.
 */
const migrations: Record<number, (blob: Blob, now: Date) => Blob> = {
  /**
   * v1 → v2: records become sync-ready (ADR-0003). v1 kept no times, so every
   * record is stamped with the upgrade time, a millisecond apart in stored
   * order (categories, then expenses), so they keep their order. Nothing is
   * deleted, and v1 ids are kept.
   */
  1(blob, now) {
    let tick = 0
    const stamp = (record: unknown) => {
      if (!isObject(record)) return record
      const time = new Date(now.getTime() + tick++).toISOString()
      return { ...record, createdAt: time, updatedAt: time }
    }
    const stampAll = (list: unknown) => (Array.isArray(list) ? list.map(stamp) : list)
    return { ...blob, categories: stampAll(blob.categories), expenses: stampAll(blob.expenses) }
  },
}

/**
 * Checks a parsed data blob from any source, upgrades it to the current
 * schema, and validates it in full. Fields the schema doesn't define are
 * dropped, and each list comes back in creation order.
 */
export function readTrackerData(blob: unknown, { today, now }: ReadOptions): SchemaResult {
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
    const migrate = migrations[from]
    if (!migrate) return refuse(`The data has schema version ${version}, which this app has no upgrade from.`)
    upgraded = migrate({ ...upgraded, schemaVersion: from }, now)
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

/** Thrown inside validation only, and always caught there: why the data was refused. */
class Refusal {
  readonly message: string
  constructor(message: string) {
    this.message = message
  }
}

/** Validates a blob already upgraded to the current schema, keeping only known fields. */
function validate(blob: Blob, today: string | undefined): SchemaResult {
  try {
    return { ok: true, data: validateOrThrow(blob, today) }
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message)
    throw error
  }
}

function validateOrThrow(blob: Blob, today: string | undefined): TrackerData {
  if (!Array.isArray(blob.categories)) throw new Refusal('The data has no list of categories.')
  if (!Array.isArray(blob.expenses)) throw new Refusal('The data has no list of expenses.')

  const categories: Category[] = []
  /** Whether each category id is live. */
  const categoryLive = new Map<string, boolean>()
  /** Live category names only: a deleted category's name may be used again. */
  const liveNames = new Map<string, string>()
  for (const [index, raw] of blob.categories.entries()) {
    const where = `Category ${index + 1}`
    if (!isObject(raw)) throw new Refusal(`${where} is not a category.`)
    const { id, name } = raw
    if (!isNonBlankString(id)) throw new Refusal(`${where} has no id.`)
    if (!isNonBlankString(name)) throw new Refusal(`${where} has no name.`)
    if (categoryLive.has(id)) throw new Refusal(`More than one category share the id "${id}".`)
    const sync = syncFields(raw, where)
    const live = sync.deletedAt === undefined
    if (live) {
      // Names are unique among live categories, ignoring case and surrounding whitespace.
      const nameKey = categoryNameKey(name)
      const sameName = liveNames.get(nameKey)
      if (sameName !== undefined) throw new Refusal(`There is more than one category named "${sameName}".`)
      liveNames.set(nameKey, name.trim())
    }
    categoryLive.set(id, live)
    categories.push(withSyncFields({ id, name }, sync))
  }
  if (!categoryLive.has(OTHER_CATEGORY_ID)) throw new Refusal('The data has no Other category.')
  if (!categoryLive.get(OTHER_CATEGORY_ID)) throw new Refusal('The Other category is marked deleted, but it can never be deleted.')

  const expenses: Expense[] = []
  const expenseIds = new Set<string>()
  for (const [index, raw] of blob.expenses.entries()) {
    const where = `Expense ${index + 1}`
    if (!isObject(raw)) throw new Refusal(`${where} is not an expense.`)
    const { id, amount, description, expenseDate, categoryId } = raw
    if (!isNonBlankString(id)) throw new Refusal(`${where} has no id.`)
    if (expenseIds.has(id)) throw new Refusal(`More than one expense share the id "${id}".`)
    expenseIds.add(id)
    if (amount === undefined) throw new Refusal(`${where} has no amount.`)
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      throw new Refusal(`${where} has an amount that is not a whole number of paise.`)
    }
    if (amount <= 0) throw new Refusal(`${where} has an amount that is not more than zero.`)
    if (amount > MAX_AMOUNT) throw new Refusal(`${where} has an amount above ${formatAmount(MAX_AMOUNT)}.`)
    if (!isNonBlankString(description)) throw new Refusal(`${where} has no description.`)
    if (expenseDate === undefined) throw new Refusal(`${where} has no expense date.`)
    if (typeof expenseDate !== 'string' || !isCalendarDate(expenseDate)) {
      throw new Refusal(`${where} has an expense date that is not a valid YYYY-MM-DD calendar day.`)
    }
    if (today !== undefined && expenseDate > today) throw new Refusal(`${where} has an expense date in the future (${expenseDate}).`)
    if (!isNonBlankString(categoryId)) throw new Refusal(`${where} has no category.`)
    const sync = syncFields(raw, where)
    const categoryIsLive = categoryLive.get(categoryId)
    if (categoryIsLive === undefined) throw new Refusal(`${where} points at a category that does not exist ("${categoryId}").`)
    // Live records only point at live records; a deleted expense may point at a deleted category.
    if (!categoryIsLive && sync.deletedAt === undefined) {
      throw new Refusal(`${where} points at a deleted category ("${categoryId}").`)
    }
    expenses.push(withSyncFields({ id, amount, description, expenseDate, categoryId }, sync))
  }

  return { schemaVersion: SCHEMA_VERSION, categories: categories.sort(byCreation), expenses: expenses.sort(byCreation) }
}

type Times = Omit<SyncFields, 'id'>

/** The record's times, refusing any that are missing or not UTC ISO 8601 (as `Date.toISOString` writes them). */
function syncFields(raw: Blob, where: string): Times {
  const { createdAt, updatedAt, deletedAt } = raw
  const check = (value: unknown, what: string): string => {
    if (value === undefined) throw new Refusal(`${where} has no ${what} time.`)
    if (!isTimestamp(value)) throw new Refusal(`${where} has a ${what} time that is not a UTC ISO 8601 timestamp.`)
    return value
  }
  const times: Times = { createdAt: check(createdAt, 'created'), updatedAt: check(updatedAt, 'updated') }
  if (deletedAt !== undefined) times.deletedAt = check(deletedAt, 'deleted')
  return times
}

/** The record with its times after its own fields, the key order the app writes, so exports compare exactly. */
function withSyncFields<T extends { id: string }>(record: T, times: Times): T & Times {
  return { ...record, ...times }
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function refuse(message: string): SchemaResult {
  return { ok: false, message }
}

function isObject(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
