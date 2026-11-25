import { describe, expect, it } from 'vitest'
import { createExpenseTracker, type ExpenseTracker } from './expenseTracker.ts'
import schemaV1Fixture from './fixtures/schema-v1.json?raw'
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

describe('adding a category', () => {
  it('adds a category that can be chosen for an expense, and keeps it after a reload', () => {
    const { tracker, storage } = setup()

    const result = tracker.addCategory('  Travel  ')

    expect(result).toMatchObject({ ok: true, value: { name: 'Travel' } })
    if (!result.ok) return
    expect(tracker.categories().map((c) => c.name)).toContain('Travel')
    expect(tracker.addExpense({ ...valid, categoryId: result.value.id }).ok).toBe(true)
    expect(setup(storage).tracker.categories()).toContainEqual(result.value)
  })

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['a duplicate', 'Food'],
    ['a duplicate ignoring case', 'fOOd'],
    ['a duplicate ignoring surrounding whitespace', '  other '],
  ])('rejects a name that is %s, changing nothing', (_, name) => {
    const { tracker, storage } = setup()
    const before = structuredClone(tracker.categories())

    const result = tracker.addCategory(name)

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryName' } })
    expect(tracker.categories()).toEqual(before)
    expect(setup(storage).tracker.categories()).toEqual(before)
  })
})

describe('renaming a category', () => {
  it('renames it, keeps its expenses attached, and keeps the new name after a reload', () => {
    const { tracker, storage } = setup()
    const expense = addOrFail(tracker, { ...valid, categoryId: 'food' })

    const result = tracker.renameCategory('food', ' Groceries ')

    expect(result).toEqual({ ok: true, value: { id: 'food', name: 'Groceries' } })
    const { tracker: reloaded } = setup(storage)
    expect(reloaded.categories()).toContainEqual({ id: 'food', name: 'Groceries' })
    expect(reloaded.categories().map((c) => c.name)).not.toContain('Food')
    expect(reloaded.expensesInMonth('2026-11')).toEqual([expense])
  })

  it('lets a category change the case of its own name', () => {
    const { tracker } = setup()

    expect(tracker.renameCategory('food', 'FOOD')).toEqual({ ok: true, value: { id: 'food', name: 'FOOD' } })
  })

  it.each([
    ['empty', '  '],
    ["another category's name", 'transport'],
  ])('rejects a new name that is %s, changing nothing', (_, name) => {
    const { tracker, storage } = setup()
    const before = structuredClone(tracker.categories())

    const result = tracker.renameCategory('food', name)

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryName' } })
    expect(tracker.categories()).toEqual(before)
    expect(setup(storage).tracker.categories()).toEqual(before)
  })

  it('refuses to rename a category that does not exist', () => {
    const { tracker } = setup()

    expect(tracker.renameCategory('no-such-category', 'Travel')).toMatchObject({
      ok: false,
      error: { field: 'category' },
    })
  })
})

describe('deleting a category', () => {
  it('reports how many expenses, across every month, would move to Other', () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, categoryId: 'food', expenseDate: '2026-11-20' })
    addOrFail(tracker, { ...valid, categoryId: 'food', expenseDate: '2026-09-01' })
    addOrFail(tracker, { ...valid, categoryId: 'transport' })

    expect(tracker.expensesMovedOnDelete('food')).toBe(2)
    expect(tracker.expensesMovedOnDelete('rent')).toBe(0)
  })

  it('moves its expenses to Other and removes it, and both changes survive a reload', () => {
    const { tracker, storage } = setup()
    const food = addOrFail(tracker, { ...valid, categoryId: 'food' })
    const transport = addOrFail(tracker, { ...valid, categoryId: 'transport' })

    const result = tracker.deleteCategory('food')

    expect(result).toEqual({ ok: true, value: { category: { id: 'food', name: 'Food' }, movedExpenseCount: 1 } })
    const { tracker: reloaded } = setup(storage)
    expect(reloaded.categories().map((c) => c.name)).not.toContain('Food')
    expect(food.categoryId).toBe('food')
    expect(reloaded.expensesInMonth('2026-11')).toEqual([transport, { ...food, categoryId: 'other' }])
    expect(reloaded.monthlyTotal('2026-11')).toBe(20000)
  })

  it('refuses to delete a category that does not exist', () => {
    const { tracker } = setup()

    expect(tracker.deleteCategory('no-such-category')).toMatchObject({ ok: false, error: { field: 'category' } })
  })

  it('refuses to delete Other, even after it has been renamed', () => {
    const { tracker, storage } = setup()
    const expense = addOrFail(tracker, { ...valid, categoryId: 'other' })
    tracker.renameCategory('other', 'Miscellaneous')

    const result = tracker.deleteCategory('other')

    expect(result).toMatchObject({ ok: false, error: { field: 'category', message: expect.stringMatching(/can't be deleted/) } })
    const { tracker: reloaded } = setup(storage)
    expect(reloaded.categories()).toContainEqual({ id: 'other', name: 'Miscellaneous' })
    expect(reloaded.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('exporting', () => {
  it('exports every category and every expense, in every month, in the stored data shape', () => {
    const { tracker } = setup()
    const october = addOrFail(tracker, { ...valid, amount: '0.10', expenseDate: '2026-10-31' })
    const november = addOrFail(tracker, { ...valid, amount: '1250.50', description: 'Electricity', categoryId: 'bills' })

    const exported = JSON.parse(tracker.exportToJson())

    expect(exported).toEqual({
      schemaVersion: 1,
      categories: [
        { id: 'food', name: 'Food' },
        { id: 'transport', name: 'Transport' },
        { id: 'rent', name: 'Rent' },
        { id: 'bills', name: 'Bills' },
        { id: 'shopping', name: 'Shopping' },
        { id: 'health', name: 'Health' },
        { id: 'entertainment', name: 'Entertainment' },
        { id: 'other', name: 'Other' },
      ],
      expenses: [
        { id: october.id, amount: 10, description: 'Groceries', expenseDate: '2026-10-31', categoryId: 'food' },
        { id: november.id, amount: 125050, description: 'Electricity', expenseDate: '2026-11-20', categoryId: 'bills' },
      ],
    })
  })

  it("names the export file with today's local date", () => {
    const { tracker } = setup(fakeStorage(), new Date(2027, 0, 5, 23, 59))

    expect(tracker.exportFileName()).toBe('expense-tracker-export-2027-01-05.json')
  })
})

describe('importing', () => {
  it('gives back exactly the exported data, replacing all current data, and keeps it after a reload', () => {
    const { tracker: source } = setup()
    addOrFail(source, { ...valid, amount: '0.10', expenseDate: '2026-10-31' })
    addOrFail(source, { ...valid, amount: '1250.50', description: 'Electricity', categoryId: 'bills' })
    const exported = source.exportToJson()

    const { tracker, storage } = setup()
    addOrFail(tracker, { ...valid, description: 'Replaced by the import' })
    const result = tracker.importFromJson(exported)

    expect(result.ok).toBe(true)
    expect(tracker.exportToJson()).toBe(exported)
    expect(setup(storage).tracker.exportToJson()).toBe(exported)
  })

  // Each schema version adds a fixture for the version before it, so old export files keep importing.
  it('imports a version 1 export file', () => {
    const { tracker, storage } = setup()

    const result = tracker.importFromJson(schemaV1Fixture)

    expect(result).toEqual({ ok: true, value: { categories: 9, expenses: 3 } })
    for (const t of [tracker, setup(storage).tracker]) {
      expect(t.categories().at(-1)).toEqual({ id: '3f0c2a7e-5b1d-4c8e-9a6f-1d2e3c4b5a69', name: 'Books' })
      expect(t.expensesInMonth('2026-10')).toMatchObject([{ amount: 1250, description: 'Chai and samosa' }])
      expect(t.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Novel', 'November rent'])
      expect(t.monthlyTotal('2026-11')).toBe(2_549_900)
    }
  })

  it('says how many categories and expenses were imported', () => {
    const { tracker } = setup()

    const result = tracker.importFromJson(JSON.stringify(importFile()))

    expect(result).toEqual({ ok: true, value: { categories: 3, expenses: 2 } })
  })

  /** Imports `file`, expecting it to be rejected with `reason` and current data left untouched. */
  function expectRejected(file: string, reason: RegExp) {
    const { tracker, storage } = setup()
    addOrFail(tracker, { ...valid, description: 'Already here' })
    const before = tracker.exportToJson()

    const result = tracker.importFromJson(file)

    expect(result).toMatchObject({ ok: false, error: { field: 'import' } })
    expect(result.ok || result.error.message).toMatch(reason)
    expect(tracker.exportToJson()).toBe(before)
    expect(setup(storage).tracker.exportToJson()).toBe(before)
  }

  it.each([
    ['text that is not JSON', '{ "schemaVersion": 1, '],
    ['an empty file', ''],
  ])('rejects %s', (_, file) => {
    expectRejected(file, /not valid JSON/)
  })

  it.each([
    ['newer than the app understands', 2],
    ['unknown', 0],
    ['not an integer', 1.5],
    ['text', '1'],
  ])('rejects a file whose schemaVersion is %s', (_, schemaVersion) => {
    expectRejected(JSON.stringify({ ...importFile(), schemaVersion }), /schema version/i)
  })

  it('rejects a file with no schemaVersion', () => {
    const { schemaVersion: _, ...file } = importFile()
    expectRejected(JSON.stringify(file), /schema version/i)
  })

  it.each([
    ['a JSON value that is not an object', '[]', /not expense tracker data/],
    ['no categories', JSON.stringify({ ...importFile(), categories: undefined }), /categories/],
    ['no expenses', JSON.stringify({ ...importFile(), expenses: undefined }), /expenses/],
    ['categories that are not a list', JSON.stringify({ ...importFile(), categories: {} }), /categories/],
  ])('rejects a file with %s', (_, file, reason) => {
    expectRejected(file, reason)
  })

  it.each(['id', 'name'])('rejects a category with no %s', (field) => {
    const file = importFile()
    delete (file.categories[1] as Record<string, unknown>)[field]
    expectRejected(JSON.stringify(file), new RegExp(`category 2 .*${field}`, 'i'))
  })

  it.each(['id', 'amount', 'description', 'expenseDate', 'categoryId'])('rejects an expense with no %s', (field) => {
    const file = importFile()
    delete file.expenses[1][field]
    expectRejected(JSON.stringify(file), new RegExp(`expense 2 .*${field === 'expenseDate' ? 'expense date' : field === 'categoryId' ? 'category' : field}`, 'i'))
  })

  it.each([
    ['not an integer of minor units', 12.5],
    ['zero', 0],
    ['negative', -100],
    ['text', '1250'],
    ['above ₹1,00,00,000', 1_000_000_001],
  ])('rejects an expense whose amount is %s', (_, amount) => {
    const file = importFile()
    file.expenses[1].amount = amount
    expectRejected(JSON.stringify(file), /expense 2 .*amount/i)
  })

  it.each([
    ['malformed', '24/11/2026', /expense 2 .*expense date/i],
    ['an impossible calendar day', '2026-02-30', /expense 2 .*expense date/i],
    ['a timestamp', '2026-11-20T10:00:00Z', /expense 2 .*expense date/i],
    ['not text', 20261120, /expense 2 .*expense date/i],
    ['in the future', '2026-11-25', /expense 2 .*future/i],
  ])('rejects an expense whose expense date is %s', (_, expenseDate, reason) => {
    const file = importFile()
    file.expenses[1].expenseDate = expenseDate
    expectRejected(JSON.stringify(file), reason)
  })

  it('rejects an expense pointing at a category that does not exist', () => {
    const file = importFile()
    file.expenses[1].categoryId = 'no-such-category'
    expectRejected(JSON.stringify(file), /expense 2 .*category that does not exist/i)
  })

  it('rejects duplicate category names, ignoring case and surrounding whitespace', () => {
    const file = importFile()
    file.categories.push({ id: 'food-again', name: '  FOOD ' })
    expectRejected(JSON.stringify(file), /more than one category named "Food"/i)
  })

  it('rejects a file with no Other category', () => {
    const file = importFile()
    file.categories = file.categories.filter((c) => c.id !== 'other')
    expectRejected(JSON.stringify(file), /no Other category/i)
  })

  it.each([
    ['categories', (f: ReturnType<typeof importFile>) => f.categories.push({ id: 'food', name: 'Groceries' })],
    ['expenses', (f: ReturnType<typeof importFile>) => f.expenses.push({ ...f.expenses[0] })],
  ])('rejects %s that share an id', (_, duplicate) => {
    const file = importFile()
    duplicate(file)
    expectRejected(JSON.stringify(file), /share the id/i)
  })
})

/** A small, valid import file in the current schema. */
function importFile() {
  return {
    schemaVersion: 1,
    categories: [
      { id: 'food', name: 'Food' },
      { id: 'books', name: 'Books' },
      { id: 'other', name: 'Other' },
    ],
    expenses: [
      { id: 'e1', amount: 1250, description: 'Chai and samosa', expenseDate: '2026-11-20', categoryId: 'food' },
      { id: 'e2', amount: 49900, description: 'Novel', expenseDate: '2026-11-24', categoryId: 'books' },
    ] as Record<string, unknown>[],
  }
}

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
  it("gives a category total for each category with expenses in the month, largest first, leaving out the rest", () => {
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

  it('shows the new name after a rename, and the totals still add up exactly to the monthly total', () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'bills' })
    tracker.renameCategory('food', 'Groceries')

    const totals = tracker.categoryTotals('2026-11')

    expect(totals).toEqual([
      { categoryId: 'bills', name: 'Bills', total: 20 },
      { categoryId: 'food', name: 'Groceries', total: 10 },
    ])
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(tracker.monthlyTotal('2026-11'))
  })

  it("counts a deleted category's expenses in Other's total, and the totals still add up to the monthly total", () => {
    const { tracker } = setup()
    addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'other' })
    addOrFail(tracker, { ...valid, amount: '5', categoryId: 'rent' })
    tracker.deleteCategory('food')

    const totals = tracker.categoryTotals('2026-11')

    expect(totals).toEqual([
      { categoryId: 'rent', name: 'Rent', total: 500 },
      { categoryId: 'other', name: 'Other', total: 30 },
    ])
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(tracker.monthlyTotal('2026-11'))
  })

  it('gives no category totals for a month with no expenses', () => {
    const { tracker } = setup()
    addOrFail(tracker)

    expect(tracker.monthlyTotal('2026-08')).toBe(0)
    expect(tracker.categoryTotals('2026-08')).toEqual([])
  })
})

describe('stored data', () => {
  const STORAGE_KEY = 'expense-tracker'

  /** A fake Storage already holding `text` as the stored data, as left by an earlier visit. */
  function seeded(text: string) {
    const storage = fakeStorage()
    storage.setItem(STORAGE_KEY, text)
    return storage
  }

  // Each schema version adds a fixture for the version before it, so data saved by an older app keeps loading.
  it('loads stored data saved by version 1 and saves it back in the current schema', () => {
    const storage = seeded(schemaV1Fixture)

    const { tracker } = setup(storage)

    expect(tracker.storedDataProblem()).toBeNull()
    expect(tracker.categories().at(-1)).toEqual({ id: '3f0c2a7e-5b1d-4c8e-9a6f-1d2e3c4b5a69', name: 'Books' })
    expect(tracker.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Novel', 'November rent'])
    expect(tracker.monthlyTotal('2026-11')).toBe(2_549_900)
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(JSON.parse(tracker.exportToJson()))
  })

  it('drops fields the schema does not define from stored data when saving it back', () => {
    const file = { ...importFile(), leftover: 'from a buggy build' }
    const storage = seeded(JSON.stringify(file))

    setup(storage)

    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).not.toHaveProperty('leftover')
  })

  it('reports stored data that is not valid JSON, and leaves it in storage', () => {
    const corrupt = '{ "schemaVersion": 1, "categories": ['
    const { tracker, storage } = setup(seeded(corrupt))

    expect(tracker.storedDataProblem()).toMatchObject({ message: expect.stringMatching(/not valid JSON/), storedText: corrupt })
    expect(storage.getItem(STORAGE_KEY)).toBe(corrupt)
  })

  it('names the download of unreadable stored data with today’s date', () => {
    const { tracker } = setup(seeded('not json at all'))

    expect(tracker.storedDataProblem()?.fileName).toBe('expense-tracker-unreadable-data-2026-11-24.txt')
  })

  it('reports stored data that fails validation, with the same reason an import would give', () => {
    const file = importFile()
    file.expenses[1].amount = 12.5
    const { tracker } = setup(seeded(JSON.stringify(file)))

    expect(tracker.storedDataProblem()?.message).toMatch(/expense 2 .*amount/i)
  })

  it('loads stored data with an expense dated after today, as when the clock or time zone has moved back', () => {
    const file = importFile()
    file.expenses[1].expenseDate = '2026-11-25'
    const { tracker } = setup(seeded(JSON.stringify(file)))

    expect(tracker.storedDataProblem()).toBeNull()
    expect(tracker.expensesInMonth('2026-11').map((e) => e.expenseDate)).toEqual(['2026-11-25', '2026-11-20'])
  })

  it('reports stored data from a newer schema version rather than guessing at it', () => {
    const { tracker } = setup(seeded(JSON.stringify({ ...importFile(), schemaVersion: 2 })))

    expect(tracker.storedDataProblem()?.message).toMatch(/newer than this app understands/)
  })

  it.each([
    ['adding an expense', (t: ExpenseTracker) => t.addExpense(valid)],
    ['adding a category', (t: ExpenseTracker) => t.addCategory('Books')],
    ['renaming a category', (t: ExpenseTracker) => t.renameCategory('food', 'Groceries')],
    ['deleting a category', (t: ExpenseTracker) => t.deleteCategory('food')],
    ['importing', (t: ExpenseTracker) => t.importFromJson(JSON.stringify(importFile()))],
  ])('refuses %s while stored data is unreadable, so the stored data is never overwritten', (_, change) => {
    const corrupt = 'not json at all'
    const { tracker, storage } = setup(seeded(corrupt))

    const result = change(tracker)

    expect(result).toMatchObject({ ok: false, error: { field: 'storedData' } })
    expect(storage.getItem(STORAGE_KEY)).toBe(corrupt)
    expect(setup(storage).tracker.storedDataProblem()?.storedText).toBe(corrupt)
  })

  it('refuses editing and deleting an expense while stored data is unreadable', () => {
    const corrupt = 'not json at all'
    const { tracker, storage } = setup(seeded(corrupt))

    expect(tracker.editExpense('e1', valid)).toMatchObject({ ok: false })
    expect(tracker.deleteExpense('e1')).toMatchObject({ ok: false })
    expect(storage.getItem(STORAGE_KEY)).toBe(corrupt)
  })

  it('starts fresh with the default categories only when asked, and keeps working after a reload', () => {
    const { tracker, storage } = setup(seeded('not json at all'))

    expect(tracker.startFresh()).toEqual({ ok: true, value: undefined })

    expect(tracker.storedDataProblem()).toBeNull()
    addOrFail(tracker, { ...valid, description: 'After starting fresh' })
    const reloaded = setup(storage).tracker
    expect(reloaded.storedDataProblem()).toBeNull()
    expect(reloaded.categories().map((c) => c.name)).toEqual([
      'Food',
      'Transport',
      'Rent',
      'Bills',
      'Shopping',
      'Health',
      'Entertainment',
      'Other',
    ])
    expect(reloaded.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['After starting fresh'])
  })

  it('refuses to start fresh when stored data loaded fine, so good data is never thrown away', () => {
    const { tracker, storage } = setup()
    addOrFail(tracker)
    const before = storage.getItem(STORAGE_KEY)

    expect(tracker.startFresh()).toMatchObject({ ok: false, error: { field: 'storedData' } })
    expect(storage.getItem(STORAGE_KEY)).toBe(before)
  })
})
