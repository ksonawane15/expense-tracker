import { isCalendarDate, monthOf, toCalendarDate } from './calendarDate.ts'
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

/** A user mistake, tied to the input field it concerns. Never thrown. */
export interface ValidationError {
  field: keyof ExpenseInput
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ValidationError }

function fail(field: keyof ExpenseInput, message: string): Result<never> {
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

    addExpense(input: ExpenseInput): Result<Expense> {
      const checked = validate(input)
      if (!checked.ok) return checked
      const expense: Expense = { id: crypto.randomUUID(), ...checked.value }
      data.expenses.push(expense)
      repository.save(data)
      return { ok: true, value: expense }
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
  }
}

export type ExpenseTracker = ReturnType<typeof createExpenseTracker>
