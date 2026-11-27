/** A category name as compared for uniqueness: ignoring case and surrounding whitespace. */
export function categoryNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The fields every stored record carries so that v3 sync needs no further
 * migration (ADR-0003). Times are UTC ISO 8601 from the device clock. A record
 * is never removed: deleting it sets `deletedAt`, and it is then hidden
 * everywhere but kept in storage and in exports.
 */
export interface SyncFields {
  id: string
  createdAt: string
  updatedAt: string
  /** Set once the record is deleted; absent while it is live. */
  deletedAt?: string
}

/** A named bucket every expense belongs to exactly one of. */
export interface Category extends SyncFields {
  name: string
}

/** A single record of money spent. `amount` is in minor units (paise); see ADR-0002. */
export interface Expense extends SyncFields {
  amount: number
  description: string
  /** Calendar day the money was spent, `YYYY-MM-DD`, no time of day. */
  expenseDate: string
  categoryId: string
}

/**
 * Schema v2 stays open while v2 is being built: each v2 slice adds its own
 * kind of record here without bumping the version. It is fixed when v2 is released.
 */
export const SCHEMA_VERSION = 2

/** Every kind of stored record; each has its own IndexedDB object store, keyed by `id`. */
export const RECORD_KINDS = ['categories', 'expenses'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

/**
 * Everything the app stores and exports, deleted records included. Each list
 * is in the order its records were created (`createdAt`, then `id`).
 */
export interface TrackerData {
  schemaVersion: typeof SCHEMA_VERSION
  categories: Category[]
  expenses: Expense[]
}

/** Records of any kind, by kind: what one save writes. */
export type RecordsByKind = { [K in RecordKind]: TrackerData[K] }

/** True while a record hasn't been deleted. */
export function isLive(record: SyncFields): boolean {
  return record.deletedAt === undefined
}

/** Orders records by when they were created, oldest first, with `id` breaking ties. */
export function byCreation(a: SyncFields, b: SyncFields): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** The fallback category's fixed id. It can never be deleted. */
export const OTHER_CATEGORY_ID = 'other'

/**
 * The default categories and no expenses. `stamp` gives each new record's
 * time; it must increase on every call, so the categories keep this order.
 */
export function defaultData(stamp: () => string): TrackerData {
  const names = ['Food', 'Transport', 'Rent', 'Bills', 'Shopping', 'Health', 'Entertainment']
  const category = (id: string, name: string): Category => {
    const time = stamp()
    return { id, name, createdAt: time, updatedAt: time }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    categories: [...names.map((name) => category(name.toLowerCase(), name)), category(OTHER_CATEGORY_ID, 'Other')],
    expenses: [],
  }
}
