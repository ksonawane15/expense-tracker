import { addMonths, isCalendarDate, monthOf, toCalendarDate } from './calendarDate.ts'
import { parseAmount } from './money.ts'
import { NewerVersionError, type Repository, type StoredRecords } from './repository.ts'
import { readTrackerData, readTrackerJson } from './schema.ts'
import {
  categoryNameKey,
  defaultData,
  isLive,
  OTHER_CATEGORY_ID,
  RECORD_KINDS,
  SCHEMA_VERSION,
  type Category,
  type Expense,
  type RecordsByKind,
  type SyncFields,
  type TrackerData,
} from './types.ts'
import type { V1DataSource } from './v1LocalStorage.ts'

export interface ExpenseTrackerOptions {
  repository: Repository
  /** Where v1 kept its data; upgraded into the repository the first time it is empty. */
  v1Source?: V1DataSource
  /** Source of "now"; today and future checks use its local calendar date, and record times use it. */
  clock?: () => Date
}

/** What the user typed when adding an expense; `amount` is rupees as text. */
export interface ExpenseInput {
  amount: string
  description: string
  expenseDate: string
  categoryId: string
}

/**
 * Why an operation was refused: a mistake in one input field (`categoryName`
 * for a category's name), `'expense'` when the expense being edited or deleted
 * no longer exists, `'category'` when the category being renamed or deleted
 * no longer exists or is Other, which can't be deleted, `'import'` when an
 * import file was rejected, `'storedData'` when a change was refused because
 * stored data couldn't be read and the user hasn't started fresh, `'save'`
 * when the change couldn't be saved and has been undone, or `'newerVersion'`
 * when a newer version of the app has updated the stored data, so this one
 * must reload before it saves anything. Never thrown.
 */
export interface ValidationError {
  field: keyof ExpenseInput | 'expense' | 'categoryName' | 'category' | 'import' | 'storedData' | 'save' | 'newerVersion'
  message: string
}

/** How much went on one category in a month, in minor units. */
export interface CategoryTotal {
  categoryId: string
  name: string
  total: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ValidationError }

function fail(field: ValidationError['field'], message: string): Result<never> {
  return { ok: false, error: { field, message } }
}

const SAVE_FAILED =
  'Your change couldn’t be saved, so it has been undone. Export your data now to keep a copy of everything saved so far.'

const NEWER_VERSION =
  'A newer version of the app has updated your data, so this window can’t save any more. Reload to use the new version.'

/** Stored data that couldn't be read on open: why, and what was found, to download before starting fresh. */
export interface StoredDataProblem {
  message: string
  /** The stored data as text, exactly as found; `null` when storage couldn't be opened at all. */
  storedText: string | null
  /** `expense-tracker-unreadable-data-YYYY-MM-DD.txt`, for downloading `storedText`. */
  fileName: string
}

/**
 * Opens the expense tracker over `repository`: loads every record into memory,
 * upgrading v1 data or seeding the default categories on first run. After
 * that, every query is synchronous over the records in memory, and each change
 * is written through to the repository; a change whose save fails is undone.
 */
export async function openExpenseTracker({ repository, v1Source, clock = () => new Date() }: ExpenseTrackerOptions) {
  const today = () => toCalendarDate(clock())

  /** The latest record time issued or loaded; see `stamp`. */
  let latestTime = ''
  /**
   * A new record time from the clock, always later than every time already
   * issued or loaded, so creation order is exact even when the clock stands
   * still (as in tests) or moves back.
   */
  function stamp(): string {
    const latest = latestTime === '' ? -Infinity : Date.parse(latestTime)
    latestTime = new Date(Math.max(clock().getTime(), latest + 1)).toISOString()
    return latestTime
  }
  function noteTimes(loaded: TrackerData) {
    for (const kind of RECORD_KINDS) {
      for (const record of loaded[kind] as SyncFields[]) {
        for (const time of [record.createdAt, record.updatedAt, record.deletedAt]) {
          if (time !== undefined && time > latestTime) latestTime = time
        }
      }
    }
  }

  const problemFileName = () => `expense-tracker-unreadable-data-${today()}.txt`
  let problem: StoredDataProblem | null = null
  /**
   * Set once stored data turns out to be from a newer version of the app, on
   * open or when a save is refused. From then on nothing is saved: the newer
   * data must not be overwritten by a version that doesn't understand it.
   */
  let newerVersion = false
  let data: TrackerData = { schemaVersion: SCHEMA_VERSION, categories: [], expenses: [] }

  function adopt(loaded: TrackerData) {
    data = loaded
    noteTimes(loaded)
  }

  /**
   * Reads what the repository holds. Stored data goes through the same
   * validation and migration as an import, except that expense dates after
   * today are allowed: the app saved them itself, and a clock or time zone
   * that has moved back mustn't lock them out. Unreadable data is never
   * overwritten here: the user can download it before starting fresh.
   */
  async function readStored(stored: StoredRecords) {
    if (typeof stored.schemaVersion === 'number' && stored.schemaVersion > SCHEMA_VERSION) {
      // Not a problem to start fresh from: the data is fine, this app is just too old for it.
      newerVersion = true
      return
    }
    const read = readTrackerData(stored, { now: clock() })
    if (!read.ok) {
      problem = { message: read.message, storedText: JSON.stringify(stored, null, 2), fileName: problemFileName() }
      return
    }
    adopt(read.data)
    // Data from an older schema is saved back upgraded, so it is upgraded once.
    if (stored.schemaVersion !== SCHEMA_VERSION) {
      try {
        await repository.replaceAll(read.data)
      } catch {
        // It is upgraded again in memory next time; nothing is lost.
      }
    }
  }

  /**
   * First run on this device: stores `first`, unless another window stored
   * something meanwhile, in which case that is read instead. Resolves whether
   * `first` was stored.
   */
  async function storeFirst(first: TrackerData, onFailure: (reason: string) => StoredDataProblem): Promise<boolean> {
    try {
      if (await repository.create(first)) {
        adopt(first)
        return true
      }
      const stored = await repository.load()
      if (stored) await readStored(stored)
    } catch (error) {
      if (error instanceof NewerVersionError) newerVersion = true
      else problem = onFailure(errorText(error))
    }
    return false
  }

  async function open() {
    let stored: StoredRecords | null
    try {
      stored = await repository.load()
    } catch (error) {
      if (error instanceof NewerVersionError) {
        newerVersion = true
        return
      }
      problem = {
        message: `Your saved data couldn’t be opened (${errorText(error)}). Nothing can be saved in this browser until it can.`,
        storedText: null,
        fileName: problemFileName(),
      }
      return
    }
    if (stored) return readStored(stored)

    const v1Text = v1Source?.load() ?? null
    if (v1Text === null) {
      await storeFirst(defaultData(stamp), (reason) => ({
        message: `Your data can’t be saved in this browser (${reason}).`,
        storedText: null,
        fileName: problemFileName(),
      }))
      return
    }

    // Upgrading v1 data: the whole upgrade is written in one go, and only then is the old key retired.
    const read = readTrackerJson(v1Text, { now: clock() })
    if (!read.ok) {
      problem = { message: read.message, storedText: v1Text, fileName: problemFileName() }
      return
    }
    const upgraded = await storeFirst(read.data, (reason) => ({
      message: `Your data from the previous version couldn’t be moved to the new storage (${reason}). Nothing was changed.`,
      storedText: v1Text,
      fileName: problemFileName(),
    }))
    if (upgraded) v1Source?.retire()
  }

  await open()

  function liveCategories(): Category[] {
    return data.categories.filter(isLive)
  }

  function liveExpenses(): Expense[] {
    return data.expenses.filter(isLive)
  }

  function validate(input: ExpenseInput): Result<Pick<Expense, 'amount' | 'description' | 'expenseDate' | 'categoryId'>> {
    const amount = parseAmount(input.amount)
    if (!amount.ok) return fail('amount', amount.message)

    const description = input.description.trim()
    if (description === '') return fail('description', 'Say what the expense was for.')

    if (!isCalendarDate(input.expenseDate)) return fail('expenseDate', 'Choose a valid expense date.')
    if (input.expenseDate > today()) return fail('expenseDate', 'The expense date cannot be in the future.')

    if (!liveCategories().some((c) => c.id === input.categoryId)) {
      return fail('categoryId', 'Choose a category.')
    }

    return {
      ok: true,
      value: { amount: amount.minorUnits, description, expenseDate: input.expenseDate, categoryId: input.categoryId },
    }
  }

  /**
   * The trimmed category name, or an error if it is empty or matches another
   * live category's name ignoring case and surrounding whitespace. `exceptId`
   * is the category being renamed, which may keep (or recase) its own name.
   */
  function validateCategoryName(name: string, exceptId?: string): Result<string> {
    const trimmed = name.trim()
    if (trimmed === '') return fail('categoryName', 'Give the category a name.')
    const key = categoryNameKey(trimmed)
    const clash = liveCategories().find((c) => c.id !== exceptId && categoryNameKey(c.name) === key)
    if (clash) return fail('categoryName', `There is already a category called ${clash.name}.`)
    return { ok: true, value: trimmed }
  }

  /** The position of the live category with `id`, or an error if it no longer exists. */
  function findCategory(id: string): Result<number> {
    const index = data.categories.findIndex((c) => c.id === id && isLive(c))
    return index === -1 ? fail('category', 'That category no longer exists.') : { ok: true, value: index }
  }

  /** The position of the live expense with `id`, or an error if it no longer exists. */
  function findExpense(id: string): Result<number> {
    const index = data.expenses.findIndex((e) => e.id === id && isLive(e))
    return index === -1 ? fail('expense', 'That expense no longer exists.') : { ok: true, value: index }
  }

  /** Other's current name; stored data always has a live Other, as the schema checks. */
  function otherCategoryName(): string {
    return data.categories.find((c) => c.id === OTHER_CATEGORY_ID)?.name ?? 'Other'
  }

  /** The records in `after` that are new or changed since `before`. Records are never changed in place, so identity tells. */
  function changedRecords(before: TrackerData, after: TrackerData): Partial<RecordsByKind> {
    const changes: Partial<Record<keyof RecordsByKind, SyncFields[]>> = {}
    for (const kind of RECORD_KINDS) {
      const previous = new Map((before[kind] as SyncFields[]).map((r) => [r.id, r]))
      const changed = (after[kind] as SyncFields[]).filter((r) => previous.get(r.id) !== r)
      if (changed.length > 0) changes[kind] = changed
    }
    return changes as Partial<RecordsByKind>
  }

  type Change<T> = Result<{ next: TrackerData; value: T }>

  /** Changes run one at a time, each after the previous one's save has settled. */
  let queue: Promise<unknown> = Promise.resolve()

  /**
   * The one path every change takes. `change` works out the new data from the
   * current data without modifying it; the new data is kept in memory and
   * written through: only the records that changed, or everything when
   * `replace` is set (import, start fresh). If the write fails, the change is
   * undone and a `'save'` error comes back. While stored data couldn't be
   * read, changes are refused, so it is never overwritten until the user
   * chooses to start fresh. Once a newer version of the app has updated the
   * stored data, every change is refused until this window reloads.
   */
  function commit<T>(change: () => Change<T>, { replace = false } = {}): Promise<Result<T>> {
    const run = async (): Promise<Result<T>> => {
      if (newerVersion) return fail('newerVersion', NEWER_VERSION)
      if (problem) {
        return fail('storedData', 'Your saved data could not be read. Download it or start fresh before making changes.')
      }
      const changed = change()
      if (!changed.ok) return changed
      const previous = data
      data = changed.value.next
      try {
        if (replace) await repository.replaceAll(data)
        else await repository.put(changedRecords(previous, data))
      } catch (error) {
        data = previous
        if (error instanceof NewerVersionError) {
          newerVersion = true
          return fail('newerVersion', NEWER_VERSION)
        }
        return fail('save', SAVE_FAILED)
      }
      return { ok: true, value: changed.value.value }
    }
    const result = queue.then(run)
    queue = result
    return result
  }

  function changed<T>(next: TrackerData, value: T): Change<T> {
    return { ok: true, value: { next, value } }
  }

  return {
    /**
     * Why the stored data couldn't be read on open, with its text so the user
     * can save a copy, or `null` when it loaded fine. Until the user chooses to
     * start fresh, the stored data is never overwritten.
     */
    storedDataProblem(): StoredDataProblem | null {
      return problem
    },

    /**
     * True once stored data turns out to be from a newer version of the app,
     * found on open or when a save was refused. Nothing can be saved until this
     * window reloads and runs the newer version.
     */
    newerVersionFound(): boolean {
      return newerVersion
    },

    /**
     * Replaces stored data that couldn't be read with the default categories
     * and no expenses, and saves it. Only for after the user has confirmed;
     * refused when the stored data loaded fine.
     */
    startFresh(): Promise<Result<void>> {
      const run = async (): Promise<Result<void>> => {
        if (!problem) return fail('storedData', 'Your saved data loaded fine, so there is nothing to start fresh from.')
        const fresh = defaultData(stamp)
        try {
          await repository.replaceAll(fresh)
        } catch (error) {
          if (error instanceof NewerVersionError) {
            newerVersion = true
            return fail('newerVersion', NEWER_VERSION)
          }
          return fail('save', 'Starting fresh couldn’t be saved, so nothing has changed.')
        }
        adopt(fresh)
        problem = null
        return { ok: true, value: undefined }
      }
      const result = queue.then(run)
      queue = result
      return result
    },

    /** Today's local calendar date, `YYYY-MM-DD`: the default expense date. */
    today,

    /** The month containing today, `YYYY-MM`: the month the app opens on. */
    currentMonth(): string {
      return monthOf(today())
    },

    /** The month (`YYYY-MM`) before `month`. */
    previousMonth(month: string): string {
      return addMonths(month, -1)
    },

    /** The month (`YYYY-MM`) after `month`. */
    nextMonth(month: string): string {
      return addMonths(month, 1)
    },

    /** The live categories, in the order they were created. */
    categories(): Category[] {
      return liveCategories()
    },

    /** The current name of Other, which the user may have renamed. */
    otherCategoryName(): string {
      return otherCategoryName()
    },

    addCategory(name: string): Promise<Result<Category>> {
      return commit(() => {
        const checked = validateCategoryName(name)
        if (!checked.ok) return checked
        const time = stamp()
        const category: Category = { id: crypto.randomUUID(), name: checked.value, createdAt: time, updatedAt: time }
        return changed({ ...data, categories: [...data.categories, category] }, category)
      })
    },

    /** Changes a category's name under the same rules as adding one. Its expenses stay attached by id. */
    renameCategory(id: string, name: string): Promise<Result<Category>> {
      return commit(() => {
        const found = findCategory(id)
        if (!found.ok) return found
        const checked = validateCategoryName(name, id)
        if (!checked.ok) return checked
        const category: Category = { ...data.categories[found.value], name: checked.value, updatedAt: stamp() }
        return changed({ ...data, categories: data.categories.with(found.value, category) }, category)
      })
    },

    /** How many expenses, in any month, would move to Other if the category were deleted. */
    expensesMovedOnDelete(id: string): number {
      return liveExpenses().filter((e) => e.categoryId === id).length
    },

    /**
     * Deletes a category, moving its expenses to Other. The category is kept
     * as a deleted record (ADR-0003). Other itself can't be deleted.
     */
    deleteCategory(id: string): Promise<Result<{ category: Category; movedExpenseCount: number }>> {
      return commit(() => {
        if (id === OTHER_CATEGORY_ID) {
          return fail('category', `${otherCategoryName()} can't be deleted: it's where expenses from deleted categories go.`)
        }
        const found = findCategory(id)
        if (!found.ok) return found
        const time = stamp()
        const category: Category = { ...data.categories[found.value], updatedAt: time, deletedAt: time }
        let movedExpenseCount = 0
        const expenses = data.expenses.map((e) => {
          if (e.categoryId !== id || !isLive(e)) return e
          movedExpenseCount++
          return { ...e, categoryId: OTHER_CATEGORY_ID, updatedAt: time }
        })
        const categories = data.categories.with(found.value, category)
        return changed({ ...data, categories, expenses }, { category, movedExpenseCount })
      })
    },

    addExpense(input: ExpenseInput): Promise<Result<Expense>> {
      return commit(() => {
        const checked = validate(input)
        if (!checked.ok) return checked
        const time = stamp()
        const expense: Expense = { id: crypto.randomUUID(), ...checked.value, createdAt: time, updatedAt: time }
        return changed({ ...data, expenses: [...data.expenses, expense] }, expense)
      })
    },

    /** Replaces every field of an existing expense, under the same rules as adding one. */
    editExpense(id: string, input: ExpenseInput): Promise<Result<Expense>> {
      return commit(() => {
        const found = findExpense(id)
        if (!found.ok) return found
        const checked = validate(input)
        if (!checked.ok) return checked
        // createdAt is kept, so an edit doesn't count as "more recently added".
        const expense: Expense = { ...data.expenses[found.value], ...checked.value, updatedAt: stamp() }
        return changed({ ...data, expenses: data.expenses.with(found.value, expense) }, expense)
      })
    },

    /** Deletes an expense, keeping it as a deleted record (ADR-0003), and returns it. */
    deleteExpense(id: string): Promise<Result<Expense>> {
      return commit(() => {
        const found = findExpense(id)
        if (!found.ok) return found
        const time = stamp()
        const deleted: Expense = { ...data.expenses[found.value], updatedAt: time, deletedAt: time }
        return changed({ ...data, expenses: data.expenses.with(found.value, deleted) }, deleted)
      })
    },

    /**
     * Live expenses whose expense date falls in `month` (`YYYY-MM`), newest
     * expense date first; on the same day, the most recently added comes first.
     */
    expensesInMonth(month: string): Expense[] {
      return liveExpenses()
        .filter((e) => monthOf(e.expenseDate) === month)
        .sort(
          (a, b) =>
            b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        )
    },

    /** Sum of the month's amounts, in minor units. */
    monthlyTotal(month: string): number {
      return this.expensesInMonth(month).reduce((total, e) => total + e.amount, 0)
    },

    /**
     * Every record, in every month, deleted ones included, as a JSON string in
     * the schema v2 shape `{ schemaVersion, categories, expenses }`, with
     * amounts in integer minor units (ADR-0002). Import reads this back.
     */
    exportToJson(): string {
      return JSON.stringify(data, null, 2)
    },

    /** `expense-tracker-export-YYYY-MM-DD.json`, dated with today's local date. */
    exportFileName(): string {
      return `expense-tracker-export-${today()}.json`
    },

    /**
     * A category total (minor units) for each category with expenses in
     * `month`, largest first; ties keep category order. Categories with no
     * expenses that month are left out. Totals always add up to the monthly total.
     */
    categoryTotals(month: string): CategoryTotal[] {
      const totals = new Map<string, number>()
      for (const e of this.expensesInMonth(month)) {
        totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount)
      }
      return liveCategories()
        .filter((c) => totals.has(c.id))
        .map((c) => ({ categoryId: c.id, name: c.name, total: totals.get(c.id)! }))
        .sort((a, b) => b.total - a.total)
    },

    /**
     * Replaces all data, deleted records included, with an export file's
     * content and saves it straight away. All or nothing: a file with any
     * invalid content is rejected with the reason, and current data is left
     * untouched. Returns how many live categories and expenses were imported.
     */
    importFromJson(json: string): Promise<Result<{ categories: number; expenses: number }>> {
      return commit(
        () => {
          const read = readTrackerJson(json, { today: today(), now: clock() })
          if (!read.ok) return fail('import', read.message)
          noteTimes(read.data)
          const { categories, expenses } = read.data
          return changed(read.data, {
            categories: categories.filter(isLive).length,
            expenses: expenses.filter(isLive).length,
          })
        },
        { replace: true },
      )
    },
  }
}

export type ExpenseTracker = Awaited<ReturnType<typeof openExpenseTracker>>

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
