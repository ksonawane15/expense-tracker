import { isCalendarDate, monthOf, toCalendarDate } from './calendarDate.ts'
import { parseAmount } from './money.ts'
import type { Repository } from './repository.ts'
import { OTHER_CATEGORY_ID, type Category, type Expense } from './types.ts'

export interface ExpenseTrackerOptions {
  repository: Repository
  /** Source of "now"; today and future checks use its local calendar date. */
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
 * no longer exists, or `'category'` when the category being renamed or deleted
 * no longer exists or is Other, which can't be deleted. Never thrown.
 */
export interface ValidationError {
  field: keyof ExpenseInput | 'expense' | 'categoryName' | 'category'
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ValidationError }

function fail(field: ValidationError['field'], message: string): Result<never> {
  return { ok: false, error: { field, message } }
}

export function createExpenseTracker({ repository, clock = () => new Date() }: ExpenseTrackerOptions) {
  const data = repository.load()

  const today = () => toCalendarDate(clock())

  function validate(input: ExpenseInput): Result<Omit<Expense, 'id'>> {
    const amount = parseAmount(input.amount)
    if (!amount.ok) return fail('amount', amount.message)

    const description = input.description.trim()
    if (description === '') return fail('description', 'Say what the expense was for.')

    if (!isCalendarDate(input.expenseDate)) return fail('expenseDate', 'Choose a valid expense date.')
    if (input.expenseDate > today()) return fail('expenseDate', 'The expense date cannot be in the future.')

    if (!data.categories.some((c) => c.id === input.categoryId)) {
      return fail('categoryId', 'Choose a category.')
    }

    return {
      ok: true,
      value: { amount: amount.minorUnits, description, expenseDate: input.expenseDate, categoryId: input.categoryId },
    }
  }

  /**
   * The trimmed category name, or an error if it is empty or matches another
   * category's name ignoring case and surrounding whitespace. `exceptId` is
   * the category being renamed, which may keep (or recase) its own name.
   */
  function validateCategoryName(name: string, exceptId?: string): Result<string> {
    const trimmed = name.trim()
    if (trimmed === '') return fail('categoryName', 'Give the category a name.')
    const key = trimmed.toLowerCase()
    const clash = data.categories.find((c) => c.id !== exceptId && c.name.trim().toLowerCase() === key)
    if (clash) return fail('categoryName', `There is already a category called ${clash.name}.`)
    return { ok: true, value: trimmed }
  }

  /** The stored position of the category with `id`, or an error if it no longer exists. */
  function findCategory(id: string): Result<number> {
    const index = data.categories.findIndex((c) => c.id === id)
    return index === -1 ? fail('category', 'That category no longer exists.') : { ok: true, value: index }
  }

  /** The stored position of the expense with `id`, or an error if it no longer exists. */
  function findExpense(id: string): Result<number> {
    const index = data.expenses.findIndex((e) => e.id === id)
    return index === -1 ? fail('expense', 'That expense no longer exists.') : { ok: true, value: index }
  }

  return {
    /** Today's local calendar date, `YYYY-MM-DD`: the default expense date. */
    today,

    /** The month containing today, `YYYY-MM`: the month the app opens on. */
    currentMonth(): string {
      return monthOf(today())
    },

    categories(): Category[] {
      return data.categories
    },

    addCategory(name: string): Result<Category> {
      const checked = validateCategoryName(name)
      if (!checked.ok) return checked
      const category: Category = { id: crypto.randomUUID(), name: checked.value }
      data.categories.push(category)
      repository.save(data)
      return { ok: true, value: category }
    },

    /** Changes a category's name under the same rules as adding one. Its expenses stay attached by id. */
    renameCategory(id: string, name: string): Result<Category> {
      const found = findCategory(id)
      if (!found.ok) return found
      const checked = validateCategoryName(name, id)
      if (!checked.ok) return checked
      const category: Category = { id, name: checked.value }
      data.categories[found.value] = category
      repository.save(data)
      return { ok: true, value: category }
    },

    /** How many expenses, in any month, would move to Other if the category were deleted. */
    expensesMovedOnDelete(id: string): number {
      return data.expenses.filter((e) => e.categoryId === id).length
    },

    /** Removes a category, moving its expenses to Other. Other itself can't be deleted. */
    deleteCategory(id: string): Result<{ category: Category; movedExpenseCount: number }> {
      if (id === OTHER_CATEGORY_ID) {
        const other = data.categories.find((c) => c.id === OTHER_CATEGORY_ID)
        return fail('category', `${other?.name ?? 'Other'} can't be deleted: it's where expenses from deleted categories go.`)
      }
      const found = findCategory(id)
      if (!found.ok) return found
      let movedExpenseCount = 0
      data.expenses = data.expenses.map((e) => {
        if (e.categoryId !== id) return e
        movedExpenseCount++
        return { ...e, categoryId: OTHER_CATEGORY_ID }
      })
      const [category] = data.categories.splice(found.value, 1)
      repository.save(data)
      return { ok: true, value: { category, movedExpenseCount } }
    },

    addExpense(input: ExpenseInput): Result<Expense> {
      const checked = validate(input)
      if (!checked.ok) return checked
      const expense: Expense = { id: crypto.randomUUID(), ...checked.value }
      data.expenses.push(expense)
      repository.save(data)
      return { ok: true, value: expense }
    },

    /** Replaces every field of an existing expense, under the same rules as adding one. */
    editExpense(id: string, input: ExpenseInput): Result<Expense> {
      const found = findExpense(id)
      if (!found.ok) return found
      const checked = validate(input)
      if (!checked.ok) return checked
      // Kept in place, so an edit doesn't count as "more recently added".
      const expense: Expense = { id, ...checked.value }
      data.expenses[found.value] = expense
      repository.save(data)
      return { ok: true, value: expense }
    },

    /** Removes an expense, returning what was removed. */
    deleteExpense(id: string): Result<Expense> {
      const found = findExpense(id)
      if (!found.ok) return found
      const [removed] = data.expenses.splice(found.value, 1)
      repository.save(data)
      return { ok: true, value: removed }
    },

    /**
     * Expenses whose expense date falls in `month` (`YYYY-MM`), newest expense
     * date first; on the same day, the most recently added comes first.
     */
    expensesInMonth(month: string): Expense[] {
      // Expenses are stored in the order they were added, so reversing puts the
      // most recently added first and the stable sort keeps that within a day.
      return data.expenses
        .filter((e) => monthOf(e.expenseDate) === month)
        .reverse()
        .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
    },

    /** Sum of the month's amounts, in minor units. */
    monthlyTotal(month: string): number {
      return this.expensesInMonth(month).reduce((total, e) => total + e.amount, 0)
    },

    /**
     * Every category and expense, in every month, as a JSON string in exactly
     * the stored data shape `{ schemaVersion, categories, expenses }`, with
     * amounts in integer minor units (ADR-0002). Import reads this back.
     */
    exportToJson(): string {
      return JSON.stringify(data, null, 2)
    },

    /** `expense-tracker-export-YYYY-MM-DD.json`, dated with today's local date. */
    exportFileName(): string {
      return `expense-tracker-export-${today()}.json`
    },
  }
}

export type ExpenseTracker = ReturnType<typeof createExpenseTracker>
