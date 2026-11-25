import { addMonths, isCalendarDate, monthOf, toCalendarDate } from './calendarDate.ts'
import { parseAmount } from './money.ts'
import type { Repository } from './repository.ts'
import type { Category, Expense } from './types.ts'

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
 * Why an operation was refused: a mistake in one input field, or `'expense'`
 * when the expense being edited or deleted no longer exists. Never thrown.
 */
export interface ValidationError {
  field: keyof ExpenseInput | 'expense'
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

    /** The month (`YYYY-MM`) before `month`. */
    previousMonth(month: string): string {
      return addMonths(month, -1)
    },

    /** The month (`YYYY-MM`) after `month`. */
    nextMonth(month: string): string {
      return addMonths(month, 1)
    },

    categories(): Category[] {
      return data.categories
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
     * A category total (minor units) for each category with spending in
     * `month`, largest first; ties keep category order. Categories with no
     * expenses that month are left out. Totals always add up to the monthly total.
     */
    categoryTotals(month: string): CategoryTotal[] {
      const totals = new Map<string, number>()
      for (const e of this.expensesInMonth(month)) {
        totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount)
      }
      return data.categories
        .filter((c) => totals.has(c.id))
        .map((c) => ({ categoryId: c.id, name: c.name, total: totals.get(c.id)! }))
        .sort((a, b) => b.total - a.total)
    },
  }
}

export type ExpenseTracker = ReturnType<typeof createExpenseTracker>
