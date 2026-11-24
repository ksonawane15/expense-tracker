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
