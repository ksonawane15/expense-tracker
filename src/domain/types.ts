/** A category name as compared for uniqueness: ignoring case and surrounding whitespace. */
export function categoryNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** A named bucket every expense belongs to exactly one of. */
export interface Category {
  id: string
  name: string
}

/** A single record of money spent. `amount` is in minor units (paise); see ADR-0002. */
export interface Expense {
  id: string
  amount: number
  description: string
  /** Calendar day the money was spent, `YYYY-MM-DD`, no time of day. */
  expenseDate: string
  categoryId: string
}

export const SCHEMA_VERSION = 1

/** Everything the app persists, under one versioned key (ADR-0001). */
export interface TrackerData {
  schemaVersion: typeof SCHEMA_VERSION
  categories: Category[]
  expenses: Expense[]
}

/** The fallback category's fixed id. It can never be deleted. */
export const OTHER_CATEGORY_ID = 'other'

export function defaultData(): TrackerData {
  const names = ['Food', 'Transport', 'Rent', 'Bills', 'Shopping', 'Health', 'Entertainment']
  return {
    schemaVersion: SCHEMA_VERSION,
    categories: [
      ...names.map((name) => ({ id: name.toLowerCase(), name })),
      { id: OTHER_CATEGORY_ID, name: 'Other' },
    ],
    expenses: [],
  }
}
