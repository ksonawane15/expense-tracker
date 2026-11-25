import { describe, expect, it } from 'vitest'
import { createExpenseTracker } from './expenseTracker.ts'
import { createLocalStorageRepository } from './localStorageRepository.ts'

function fakeStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  }
}

function setup(storage = fakeStorage(), now = new Date(2026, 10, 24, 10, 0)) {
  const tracker = createExpenseTracker({
    repository: createLocalStorageRepository(storage),
    clock: () => now,
  })
  return { tracker, storage }
}

describe('default categories', () => {
  it('seeds the default categories on first run', () => {
    const { tracker } = setup()
    expect(tracker.categories().map((c) => c.name)).toEqual([
      'Food',
      'Transport',
      'Rent',
      'Bills',
      'Shopping',
      'Health',
      'Entertainment',
      'Other',
    ])
  })
})

const valid = {
  amount: '100',
  description: 'Groceries',
  expenseDate: '2026-11-20',
  categoryId: 'food',
}

describe('recording an expense', () => {
  it('shows a new expense in its month and adds it to the monthly total', () => {
    const { tracker } = setup()

    const result = tracker.addExpense({
      amount: '12.50',
      description: 'Chai and samosa',
      expenseDate: '2026-11-20',
      categoryId: 'food',
    })

    expect(result.ok).toBe(true)
    expect(tracker.expensesInMonth('2026-11')).toMatchObject([
      { amount: 1250, description: 'Chai and samosa', expenseDate: '2026-11-20', categoryId: 'food' },
    ])
    expect(tracker.monthlyTotal('2026-11')).toBe(1250)
  })

  it('adds amounts exactly, with no floating-point drift', () => {
    const { tracker } = setup()
    tracker.addExpense({ ...valid, amount: '0.10' })
    tracker.addExpense({ ...valid, amount: '0.20' })

    expect(tracker.monthlyTotal('2026-11')).toBe(30)
  })

  it.each([
    ['1', 100],
    ['1.5', 150],
    ['12.05', 1205],
    [' 250 ', 25000],
    ['10000000', 1_000_000_000],
  ])('accepts the amount %j as %i minor units', (amount, minorUnits) => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, amount })

    expect(result).toMatchObject({ ok: true, value: { amount: minorUnits } })
  })

  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['negative', '-5'],
    ['more than 2 decimal places', '1.234'],
    ['above ₹1,00,00,000', '10000000.01'],
    ['empty', ''],
    ['not a number', 'abc'],
    ['a bare decimal point', '.'],
    ['exponent notation', '1e3'],
    ['thousands separators', '1,000'],
  ])('rejects an amount that is %s', (_, amount) => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, amount })

    expect(result).toMatchObject({ ok: false, error: { field: 'amount' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([])
  })

  it.each([
    ['0', /more than zero/],
    ['-5', /more than zero/],
    ['1.234', /2 decimal places/],
    ['10000000.01', /₹1,00,00,000/],
    ['abc', /like 250 or 12\.50/],
  ])('explains why the amount %j was rejected', (amount, message) => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, amount })

    expect(result.ok || result.error.message).toMatch(message)
  })

  it.each(['', '   '])('rejects a blank description %j', (description) => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, description })

    expect(result).toMatchObject({ ok: false, error: { field: 'description' } })
  })

  it('trims surrounding whitespace from the description', () => {
    const { tracker } = setup()

    tracker.addExpense({ ...valid, description: '  Groceries  ' })

    expect(tracker.expensesInMonth('2026-11')[0].description).toBe('Groceries')
  })

  it('accepts an expense dated today and one dated in the past', () => {
    const { tracker } = setup(fakeStorage(), new Date(2026, 10, 24, 23, 59))

    expect(tracker.addExpense({ ...valid, expenseDate: '2026-11-24' }).ok).toBe(true)
    expect(tracker.addExpense({ ...valid, expenseDate: '2025-01-01' }).ok).toBe(true)
  })

  it.each([
    ['in the future', '2026-11-25'],
    ['malformed', '24/11/2026'],
    ['an impossible calendar day', '2026-02-30'],
    ['empty', ''],
  ])('rejects an expense date that is %s', (_, expenseDate) => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, expenseDate })

    expect(result).toMatchObject({ ok: false, error: { field: 'expenseDate' } })
  })

  it('rejects a category that does not exist', () => {
    const { tracker } = setup()

    const result = tracker.addExpense({ ...valid, categoryId: 'no-such-category' })

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryId' } })
  })

  it("gives today's local date as the default expense date", () => {
    const { tracker } = setup(fakeStorage(), new Date(2026, 0, 5, 0, 30))

    expect(tracker.today()).toBe('2026-01-05')
    expect(tracker.currentMonth()).toBe('2026-01')
  })

  it('lists a month newest expense date first, most recently added first on the same day', () => {
    const { tracker } = setup()
    tracker.addExpense({ ...valid, description: 'older', expenseDate: '2026-11-02' })
    tracker.addExpense({ ...valid, description: 'newest, added first', expenseDate: '2026-11-20' })
    tracker.addExpense({ ...valid, description: 'newest, added second', expenseDate: '2026-11-20' })
    tracker.addExpense({ ...valid, description: 'other month', expenseDate: '2026-10-31' })

    expect(tracker.expensesInMonth('2026-11').map((e) => e.description)).toEqual([
      'newest, added second',
      'newest, added first',
      'older',
    ])
  })

  it('keeps recorded expenses after a reload', () => {
    const { tracker, storage } = setup()
    tracker.addExpense({
      amount: '499',
      description: 'Metro card top-up',
      expenseDate: '2026-11-03',
      categoryId: 'transport',
    })

    const { tracker: reloaded } = setup(storage)

    expect(reloaded.expensesInMonth('2026-11')).toMatchObject([
      { amount: 49900, description: 'Metro card top-up' },
    ])
  })
})

function addOrFail(tracker: ReturnType<typeof setup>['tracker'], input = valid) {
  const result = tracker.addExpense(input)
  if (!result.ok) throw new Error(`could not add expense: ${result.error.message}`)
  return result.value
}

describe('editing an expense', () => {
  it('changes every field and updates the month list and monthly total', () => {
    const { tracker } = setup()
    const expense = addOrFail(tracker)

    const result = tracker.editExpense(expense.id, {
      amount: '250.75',
      description: 'Dinner out',
      expenseDate: '2026-11-21',
      categoryId: 'entertainment',
    })

    expect(result.ok).toBe(true)
    expect(tracker.expensesInMonth('2026-11')).toEqual([
      {
        id: expense.id,
        amount: 25075,
        description: 'Dinner out',
        expenseDate: '2026-11-21',
        categoryId: 'entertainment',
      },
    ])
    expect(tracker.monthlyTotal('2026-11')).toBe(25075)
  })

  it.each([
    ['amount', { amount: '0' }],
    ['amount', { amount: '1.234' }],
    ['amount', { amount: '-5' }],
    ['amount', { amount: 'abc' }],
    ['amount', { amount: '10000000.01' }],
    ['description', { description: '  ' }],
    ['expenseDate', { expenseDate: '2026-11-25' }],
    ['expenseDate', { expenseDate: '2026-02-30' }],
    ['categoryId', { categoryId: 'no-such-category' }],
  ] as const)('rejects an edit with an invalid %s and leaves the expense unchanged', (field, change) => {
    const { tracker, storage } = setup()
    const expense = addOrFail(tracker)

    const result = tracker.editExpense(expense.id, { ...valid, ...change })

    expect(result).toMatchObject({ ok: false, error: { field } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
    expect(setup(storage).tracker.expensesInMonth('2026-11')).toEqual([expense])
  })

  it('moves an expense to another month when its expense date changes, and keeps the edit after a reload', () => {
    const { tracker, storage } = setup()
    const expense = addOrFail(tracker, { ...valid, amount: '300' })

    tracker.editExpense(expense.id, { ...valid, amount: '300', expenseDate: '2026-10-31' })

    const { tracker: reloaded } = setup(storage)
    expect(reloaded.expensesInMonth('2026-11')).toEqual([])
    expect(reloaded.monthlyTotal('2026-11')).toBe(0)
    expect(reloaded.expensesInMonth('2026-10')).toMatchObject([{ id: expense.id, amount: 30000 }])
    expect(reloaded.monthlyTotal('2026-10')).toBe(30000)
  })

  it('refuses to edit an expense that does not exist, changing nothing', () => {
    const { tracker } = setup()
    const expense = addOrFail(tracker)

    const result = tracker.editExpense('no-such-expense', valid)

    expect(result).toMatchObject({ ok: false, error: { field: 'expense' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('deleting an expense', () => {
  it('removes it from the month list and monthly total, and keeps it gone after a reload', () => {
    const { tracker, storage } = setup()
    const kept = addOrFail(tracker, { ...valid, description: 'Kept', amount: '100' })
    const removed = addOrFail(tracker, { ...valid, description: 'Removed', amount: '40' })

    const result = tracker.deleteExpense(removed.id)

    expect(result.ok).toBe(true)
    expect(tracker.expensesInMonth('2026-11')).toEqual([kept])
    expect(tracker.monthlyTotal('2026-11')).toBe(10000)
    expect(setup(storage).tracker.expensesInMonth('2026-11')).toEqual([kept])
  })

  it('refuses to delete an expense that does not exist, changing nothing', () => {
    const { tracker } = setup()
    const expense = addOrFail(tracker)

    const result = tracker.deleteExpense('no-such-expense')

    expect(result).toMatchObject({ ok: false, error: { field: 'expense' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('browsing months', () => {
  it.each([
    ['2026-11', '2026-10', '2026-12'],
    ['2026-01', '2025-12', '2026-02'],
    ['2026-12', '2026-11', '2027-01'],
  ])('steps from %s back to %s and forward to %s', (month, previous, next) => {
    const { tracker } = setup()

    expect(tracker.previousMonth(month)).toBe(previous)
    expect(tracker.nextMonth(month)).toBe(next)
  })

  it('counts expenses on the first and last days of a month in that month only', () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '1', expenseDate: '2026-09-30' })
    addOrFail(tracker, { ...valid, amount: '10', expenseDate: '2026-10-01' })
    addOrFail(tracker, { ...valid, amount: '100', expenseDate: '2026-10-31' })
    addOrFail(tracker, { ...valid, amount: '1000', expenseDate: '2026-11-01' })

    expect(tracker.monthlyTotal('2026-09')).toBe(100)
    expect(tracker.monthlyTotal('2026-10')).toBe(11000)
    expect(tracker.monthlyTotal('2026-11')).toBe(100000)
  })

  it('counts 29 February in February of a leap year', () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '5', expenseDate: '2024-02-29' })

    expect(tracker.monthlyTotal('2024-02')).toBe(500)
    expect(tracker.monthlyTotal('2024-03')).toBe(0)
  })
})

describe('category totals', () => {
  it("gives a category total for each category with spending in the month, largest first, leaving out the rest", () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '120', categoryId: 'food' })
    addOrFail(tracker, { ...valid, amount: '30.50', categoryId: 'food' })
    addOrFail(tracker, { ...valid, amount: '15000', categoryId: 'rent' })
    addOrFail(tracker, { ...valid, amount: '45', categoryId: 'transport' })
    addOrFail(tracker, { ...valid, amount: '999', categoryId: 'health', expenseDate: '2026-10-31' })

    expect(tracker.categoryTotals('2026-11')).toEqual([
      { categoryId: 'rent', name: 'Rent', total: 1_500_000 },
      { categoryId: 'food', name: 'Food', total: 15050 },
      { categoryId: 'transport', name: 'Transport', total: 4500 },
    ])
  })

  it('category totals add up exactly to the monthly total', () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'bills' })
    addOrFail(tracker, { ...valid, amount: '0.01', categoryId: 'other' })
    addOrFail(tracker, { ...valid, amount: '10000000', categoryId: 'rent' })

    const totals = tracker.categoryTotals('2026-11')

    expect(tracker.monthlyTotal('2026-11')).toBe(1_000_000_031)
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(1_000_000_031)
  })

  it('gives no category totals for a month with no expenses', () => {
    const { tracker } = setup()
    addOrFail(tracker)

    expect(tracker.monthlyTotal('2026-08')).toBe(0)
    expect(tracker.categoryTotals('2026-08')).toEqual([])
  })
})
