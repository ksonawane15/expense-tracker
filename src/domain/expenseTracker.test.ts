import { describe, expect, it } from 'vitest'
import { openExpenseTracker, type ExpenseTracker } from './expenseTracker.ts'
import schemaV1Fixture from './fixtures/schema-v1.json?raw'
import { createMemoryRepository, type MemoryRepository } from './memoryRepository.ts'
import { createV1LocalStorageSource, V1_BACKUP_KEY, V1_STORAGE_KEY } from './v1LocalStorage.ts'

/** A fake localStorage, as v1 left it. */
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

/**
 * Opens a tracker over `repository` with a fixed clock. Opening another one
 * over the same repository is a reload: it sees only what was saved.
 */
async function setup(repository: MemoryRepository = createMemoryRepository(), now = new Date(2026, 10, 24, 10, 0)) {
  const tracker = await openExpenseTracker({ repository, clock: () => now })
  return { tracker, repository }
}

/** The live categories as `{ id, name }`, without their times. */
function idsAndNames(tracker: ExpenseTracker) {
  return tracker.categories().map(({ id, name }) => ({ id, name }))
}

describe('default categories', () => {
  it('seeds the default categories on first run', async () => {
    const { tracker } = await setup()
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
  it('shows a new expense in its month and adds it to the monthly total', async () => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({
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

  it('adds amounts exactly, with no floating-point drift', async () => {
    const { tracker } = await setup()
    await tracker.addExpense({ ...valid, amount: '0.10' })
    await tracker.addExpense({ ...valid, amount: '0.20' })

    expect(tracker.monthlyTotal('2026-11')).toBe(30)
  })

  it.each([
    ['1', 100],
    ['1.5', 150],
    ['12.05', 1205],
    [' 250 ', 25000],
    ['10000000', 1_000_000_000],
  ])('accepts the amount %j as %i minor units', async (amount, minorUnits) => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, amount })

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
  ])('rejects an amount that is %s', async (_, amount) => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, amount })

    expect(result).toMatchObject({ ok: false, error: { field: 'amount' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([])
  })

  it.each([
    ['0', /more than zero/],
    ['-5', /more than zero/],
    ['1.234', /2 decimal places/],
    ['10000000.01', /₹1,00,00,000/],
    ['abc', /like 250 or 12\.50/],
  ])('explains why the amount %j was rejected', async (amount, message) => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, amount })

    expect(result.ok || result.error.message).toMatch(message)
  })

  it.each(['', '   '])('rejects a blank description %j', async (description) => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, description })

    expect(result).toMatchObject({ ok: false, error: { field: 'description' } })
  })

  it('trims surrounding whitespace from the description', async () => {
    const { tracker } = await setup()

    await tracker.addExpense({ ...valid, description: '  Groceries  ' })

    expect(tracker.expensesInMonth('2026-11')[0].description).toBe('Groceries')
  })

  it('accepts an expense dated today and one dated in the past', async () => {
    const { tracker } = await setup(createMemoryRepository(), new Date(2026, 10, 24, 23, 59))

    expect((await tracker.addExpense({ ...valid, expenseDate: '2026-11-24' })).ok).toBe(true)
    expect((await tracker.addExpense({ ...valid, expenseDate: '2025-01-01' })).ok).toBe(true)
  })

  it.each([
    ['in the future', '2026-11-25'],
    ['malformed', '24/11/2026'],
    ['an impossible calendar day', '2026-02-30'],
    ['empty', ''],
  ])('rejects an expense date that is %s', async (_, expenseDate) => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, expenseDate })

    expect(result).toMatchObject({ ok: false, error: { field: 'expenseDate' } })
  })

  it('rejects a category that does not exist', async () => {
    const { tracker } = await setup()

    const result = await tracker.addExpense({ ...valid, categoryId: 'no-such-category' })

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryId' } })
  })

  it("gives today's local date as the default expense date", async () => {
    const { tracker } = await setup(createMemoryRepository(), new Date(2026, 0, 5, 0, 30))

    expect(tracker.today()).toBe('2026-01-05')
    expect(tracker.currentMonth()).toBe('2026-01')
  })

  it('lists a month newest expense date first, most recently added first on the same day', async () => {
    const { tracker } = await setup()
    await tracker.addExpense({ ...valid, description: 'older', expenseDate: '2026-11-02' })
    await tracker.addExpense({ ...valid, description: 'newest, added first', expenseDate: '2026-11-20' })
    await tracker.addExpense({ ...valid, description: 'newest, added second', expenseDate: '2026-11-20' })
    await tracker.addExpense({ ...valid, description: 'other month', expenseDate: '2026-10-31' })

    expect(tracker.expensesInMonth('2026-11').map((e) => e.description)).toEqual([
      'newest, added second',
      'newest, added first',
      'older',
    ])
  })

  it('keeps recorded expenses after a reload', async () => {
    const { tracker, repository } = await setup()
    await tracker.addExpense({
      amount: '499',
      description: 'Metro card top-up',
      expenseDate: '2026-11-03',
      categoryId: 'transport',
    })

    const { tracker: reloaded } = await setup(repository)

    expect(reloaded.expensesInMonth('2026-11')).toMatchObject([
      { amount: 49900, description: 'Metro card top-up' },
    ])
  })
})

async function addOrFail(tracker: ExpenseTracker, input = valid) {
  const result = await tracker.addExpense(input)
  if (!result.ok) throw new Error(`could not add expense: ${result.error.message}`)
  return result.value
}

describe('editing an expense', () => {
  it('changes every field and updates the month list and monthly total', async () => {
    const { tracker } = await setup()
    const expense = await addOrFail(tracker)

    const result = await tracker.editExpense(expense.id, {
      amount: '250.75',
      description: 'Dinner out',
      expenseDate: '2026-11-21',
      categoryId: 'entertainment',
    })

    expect(result.ok).toBe(true)
    expect(tracker.expensesInMonth('2026-11')).toMatchObject([
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
  ] as const)('rejects an edit with an invalid %s and leaves the expense unchanged', async (field, change) => {
    const { tracker, repository } = await setup()
    const expense = await addOrFail(tracker)

    const result = await tracker.editExpense(expense.id, { ...valid, ...change })

    expect(result).toMatchObject({ ok: false, error: { field } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
    expect((await setup(repository)).tracker.expensesInMonth('2026-11')).toEqual([expense])
  })

  it('moves an expense to another month when its expense date changes, and keeps the edit after a reload', async () => {
    const { tracker, repository } = await setup()
    const expense = await addOrFail(tracker, { ...valid, amount: '300' })

    await tracker.editExpense(expense.id, { ...valid, amount: '300', expenseDate: '2026-10-31' })

    const { tracker: reloaded } = await setup(repository)
    expect(reloaded.expensesInMonth('2026-11')).toEqual([])
    expect(reloaded.monthlyTotal('2026-11')).toBe(0)
    expect(reloaded.expensesInMonth('2026-10')).toMatchObject([{ id: expense.id, amount: 30000 }])
    expect(reloaded.monthlyTotal('2026-10')).toBe(30000)
  })

  it('refuses to edit an expense that does not exist, changing nothing', async () => {
    const { tracker } = await setup()
    const expense = await addOrFail(tracker)

    const result = await tracker.editExpense('no-such-expense', valid)

    expect(result).toMatchObject({ ok: false, error: { field: 'expense' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('deleting an expense', () => {
  it('removes it from the month list and monthly total, and keeps it gone after a reload', async () => {
    const { tracker, repository } = await setup()
    const kept = await addOrFail(tracker, { ...valid, description: 'Kept', amount: '100' })
    const removed = await addOrFail(tracker, { ...valid, description: 'Removed', amount: '40' })

    const result = await tracker.deleteExpense(removed.id)

    expect(result.ok).toBe(true)
    expect(tracker.expensesInMonth('2026-11')).toEqual([kept])
    expect(tracker.monthlyTotal('2026-11')).toBe(10000)
    expect((await setup(repository)).tracker.expensesInMonth('2026-11')).toEqual([kept])
  })

  it('refuses to delete an expense that does not exist, changing nothing', async () => {
    const { tracker } = await setup()
    const expense = await addOrFail(tracker)

    const result = await tracker.deleteExpense('no-such-expense')

    expect(result).toMatchObject({ ok: false, error: { field: 'expense' } })
    expect(tracker.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('adding a category', () => {
  it('adds a category that can be chosen for an expense, and keeps it after a reload', async () => {
    const { tracker, repository } = await setup()

    const result = await tracker.addCategory('  Travel  ')

    expect(result).toMatchObject({ ok: true, value: { name: 'Travel' } })
    if (!result.ok) return
    expect(tracker.categories().map((c) => c.name)).toContain('Travel')
    expect((await tracker.addExpense({ ...valid, categoryId: result.value.id })).ok).toBe(true)
    expect((await setup(repository)).tracker.categories()).toContainEqual(result.value)
  })

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['a duplicate', 'Food'],
    ['a duplicate ignoring case', 'fOOd'],
    ['a duplicate ignoring surrounding whitespace', '  other '],
  ])('rejects a name that is %s, changing nothing', async (_, name) => {
    const { tracker, repository } = await setup()
    const before = structuredClone(tracker.categories())

    const result = await tracker.addCategory(name)

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryName' } })
    expect(tracker.categories()).toEqual(before)
    expect((await setup(repository)).tracker.categories()).toEqual(before)
  })
})

describe('renaming a category', () => {
  it('renames it, keeps its expenses attached, and keeps the new name after a reload', async () => {
    const { tracker, repository } = await setup()
    const expense = await addOrFail(tracker, { ...valid, categoryId: 'food' })

    const result = await tracker.renameCategory('food', ' Groceries ')

    expect(result).toMatchObject({ ok: true, value: { id: 'food', name: 'Groceries' } })
    const { tracker: reloaded } = await setup(repository)
    expect(idsAndNames(reloaded)).toContainEqual({ id: 'food', name: 'Groceries' })
    expect(reloaded.categories().map((c) => c.name)).not.toContain('Food')
    expect(reloaded.expensesInMonth('2026-11')).toEqual([expense])
  })

  it('lets a category change the case of its own name', async () => {
    const { tracker } = await setup()

    expect(await tracker.renameCategory('food', 'FOOD')).toMatchObject({ ok: true, value: { id: 'food', name: 'FOOD' } })
  })

  it.each([
    ['empty', '  '],
    ["another category's name", 'transport'],
  ])('rejects a new name that is %s, changing nothing', async (_, name) => {
    const { tracker, repository } = await setup()
    const before = structuredClone(tracker.categories())

    const result = await tracker.renameCategory('food', name)

    expect(result).toMatchObject({ ok: false, error: { field: 'categoryName' } })
    expect(tracker.categories()).toEqual(before)
    expect((await setup(repository)).tracker.categories()).toEqual(before)
  })

  it('refuses to rename a category that does not exist', async () => {
    const { tracker } = await setup()

    expect(await tracker.renameCategory('no-such-category', 'Travel')).toMatchObject({
      ok: false,
      error: { field: 'category' },
    })
  })
})

describe('deleting a category', () => {
  it('reports how many expenses, across every month, would move to Other', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, categoryId: 'food', expenseDate: '2026-11-20' })
    await addOrFail(tracker, { ...valid, categoryId: 'food', expenseDate: '2026-09-01' })
    await addOrFail(tracker, { ...valid, categoryId: 'transport' })

    expect(tracker.expensesMovedOnDelete('food')).toBe(2)
    expect(tracker.expensesMovedOnDelete('rent')).toBe(0)
  })

  it('moves its expenses to Other and removes it, and both changes survive a reload', async () => {
    const { tracker, repository } = await setup()
    const food = await addOrFail(tracker, { ...valid, categoryId: 'food' })
    const transport = await addOrFail(tracker, { ...valid, categoryId: 'transport' })

    const result = await tracker.deleteCategory('food')

    expect(result).toMatchObject({ ok: true, value: { category: { id: 'food', name: 'Food', deletedAt: expect.any(String) }, movedExpenseCount: 1 } })
    const { tracker: reloaded } = await setup(repository)
    expect(reloaded.categories().map((c) => c.name)).not.toContain('Food')
    expect(food.categoryId).toBe('food')
    expect(reloaded.expensesInMonth('2026-11')).toMatchObject([
      { id: transport.id, categoryId: 'transport' },
      { id: food.id, categoryId: 'other' },
    ])
    expect(reloaded.monthlyTotal('2026-11')).toBe(20000)
  })

  it('refuses to delete a category that does not exist', async () => {
    const { tracker } = await setup()

    expect(await tracker.deleteCategory('no-such-category')).toMatchObject({ ok: false, error: { field: 'category' } })
  })

  it('refuses to delete Other, even after it has been renamed', async () => {
    const { tracker, repository } = await setup()
    const expense = await addOrFail(tracker, { ...valid, categoryId: 'other' })
    await tracker.renameCategory('other', 'Miscellaneous')

    const result = await tracker.deleteCategory('other')

    expect(result).toMatchObject({ ok: false, error: { field: 'category', message: expect.stringMatching(/can't be deleted/) } })
    const { tracker: reloaded } = await setup(repository)
    expect(idsAndNames(reloaded)).toContainEqual({ id: 'other', name: 'Miscellaneous' })
    expect(reloaded.expensesInMonth('2026-11')).toEqual([expense])
  })
})

describe('exporting', () => {
  it('exports every record, in every month, in the schema v2 shape, with each record’s times', async () => {
    const now = new Date(2026, 10, 24, 10, 0)
    // The clock stands still, so each new record is stamped a millisecond after the last.
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString()
    const { tracker } = await setup(createMemoryRepository(), now)
    const october = await addOrFail(tracker, { ...valid, amount: '0.10', expenseDate: '2026-10-31' })
    const november = await addOrFail(tracker, { ...valid, amount: '1250.50', description: 'Electricity', categoryId: 'bills' })

    const exported = JSON.parse(tracker.exportToJson())

    const names = ['Food', 'Transport', 'Rent', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Other']
    expect(exported).toEqual({
      schemaVersion: 2,
      categories: names.map((name, i) => ({ id: name.toLowerCase(), name, createdAt: at(i), updatedAt: at(i) })),
      expenses: [
        {
          id: october.id,
          amount: 10,
          description: 'Groceries',
          expenseDate: '2026-10-31',
          categoryId: 'food',
          createdAt: at(8),
          updatedAt: at(8),
        },
        {
          id: november.id,
          amount: 125050,
          description: 'Electricity',
          expenseDate: '2026-11-20',
          categoryId: 'bills',
          createdAt: at(9),
          updatedAt: at(9),
        },
      ],
    })
  })

  it('exports deleted records with when they were deleted', async () => {
    const { tracker } = await setup()
    await tracker.addCategory('Books')
    const expense = await addOrFail(tracker, { ...valid, description: 'Deleted later' })
    await tracker.deleteExpense(expense.id)
    await tracker.deleteCategory('food')

    const exported = JSON.parse(tracker.exportToJson())

    expect(exported.expenses).toMatchObject([{ id: expense.id, deletedAt: expect.any(String) }])
    expect(exported.categories.find((c: { id: string }) => c.id === 'food')).toMatchObject({ deletedAt: expect.any(String) })
    expect(exported.categories.find((c: { id: string }) => c.id === 'rent')).not.toHaveProperty('deletedAt')
  })

  it("names the export file with today's local date", async () => {
    const { tracker } = await setup(createMemoryRepository(), new Date(2027, 0, 5, 23, 59))

    expect(tracker.exportFileName()).toBe('expense-tracker-export-2027-01-05.json')
  })
})

describe('importing', () => {
  it('gives back exactly the exported data, replacing all current data, and keeps it after a reload', async () => {
    const { tracker: source } = await setup()
    await addOrFail(source, { ...valid, amount: '0.10', expenseDate: '2026-10-31' })
    await addOrFail(source, { ...valid, amount: '1250.50', description: 'Electricity', categoryId: 'bills' })
    const exported = source.exportToJson()

    const { tracker, repository } = await setup()
    await addOrFail(tracker, { ...valid, description: 'Replaced by the import' })
    const result = await tracker.importFromJson(exported)

    expect(result.ok).toBe(true)
    expect(tracker.exportToJson()).toBe(exported)
    expect((await setup(repository)).tracker.exportToJson()).toBe(exported)
  })

  // Each schema version adds a fixture for the version before it, so old export files keep importing.
  it('imports a version 1 export file', async () => {
    const { tracker, repository } = await setup()

    const result = await tracker.importFromJson(schemaV1Fixture)

    expect(result).toEqual({ ok: true, value: { categories: 9, expenses: 3 } })
    for (const t of [tracker, (await setup(repository)).tracker]) {
      expect(t.categories().at(-1)).toMatchObject({ id: '3f0c2a7e-5b1d-4c8e-9a6f-1d2e3c4b5a69', name: 'Books' })
      expect(t.expensesInMonth('2026-10')).toMatchObject([{ amount: 1250, description: 'Chai and samosa' }])
      expect(t.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Novel', 'November rent'])
      expect(t.monthlyTotal('2026-11')).toBe(2_549_900)
    }
  })

  it('says how many categories and expenses were imported', async () => {
    const { tracker } = await setup()

    const result = await tracker.importFromJson(JSON.stringify(importFile()))

    expect(result).toEqual({ ok: true, value: { categories: 3, expenses: 2 } })
  })

  /** Imports `file`, expecting it to be rejected with `reason` and current data left untouched. */
  async function expectRejected(file: string, reason: RegExp) {
    const { tracker, repository } = await setup()
    await addOrFail(tracker, { ...valid, description: 'Already here' })
    const before = tracker.exportToJson()

    const result = await tracker.importFromJson(file)

    expect(result).toMatchObject({ ok: false, error: { field: 'import' } })
    expect(result.ok || result.error.message).toMatch(reason)
    expect(tracker.exportToJson()).toBe(before)
    expect((await setup(repository)).tracker.exportToJson()).toBe(before)
  }

  it.each([
    ['text that is not JSON', '{ "schemaVersion": 1, '],
    ['an empty file', ''],
  ])('rejects %s', async (_, file) => {
    await expectRejected(file, /not valid JSON/)
  })

  it.each([
    ['newer than the app understands', 3],
    ['unknown', 0],
    ['not an integer', 1.5],
    ['text', '2'],
  ])('rejects a file whose schemaVersion is %s', async (_, schemaVersion) => {
    await expectRejected(JSON.stringify({ ...importFile(), schemaVersion }), /schema version/i)
  })

  it('rejects a file with no schemaVersion', async () => {
    const { schemaVersion: _, ...file } = importFile()
    await expectRejected(JSON.stringify(file), /schema version/i)
  })

  it.each([
    ['a JSON value that is not an object', '[]', /not expense tracker data/],
    ['no categories', JSON.stringify({ ...importFile(), categories: undefined }), /categories/],
    ['no expenses', JSON.stringify({ ...importFile(), expenses: undefined }), /expenses/],
    ['categories that are not a list', JSON.stringify({ ...importFile(), categories: {} }), /categories/],
  ])('rejects a file with %s', async (_, file, reason) => {
    await expectRejected(file, reason)
  })

  it.each(['id', 'name'])('rejects a category with no %s', async (field) => {
    const file = importFile()
    delete (file.categories[1] as Record<string, unknown>)[field]
    await expectRejected(JSON.stringify(file), new RegExp(`category 2 .*${field}`, 'i'))
  })

  it.each(['id', 'amount', 'description', 'expenseDate', 'categoryId'])('rejects an expense with no %s', async (field) => {
    const file = importFile()
    delete file.expenses[1][field]
    await expectRejected(JSON.stringify(file), new RegExp(`expense 2 .*${field === 'expenseDate' ? 'expense date' : field === 'categoryId' ? 'category' : field}`, 'i'))
  })

  it.each([
    ['not an integer of minor units', 12.5],
    ['zero', 0],
    ['negative', -100],
    ['text', '1250'],
    ['above ₹1,00,00,000', 1_000_000_001],
  ])('rejects an expense whose amount is %s', async (_, amount) => {
    const file = importFile()
    file.expenses[1].amount = amount
    await expectRejected(JSON.stringify(file), /expense 2 .*amount/i)
  })

  it.each([
    ['malformed', '24/11/2026', /expense 2 .*expense date/i],
    ['an impossible calendar day', '2026-02-30', /expense 2 .*expense date/i],
    ['a timestamp', '2026-11-20T10:00:00Z', /expense 2 .*expense date/i],
    ['not text', 20261120, /expense 2 .*expense date/i],
    ['in the future', '2026-11-25', /expense 2 .*future/i],
  ])('rejects an expense whose expense date is %s', async (_, expenseDate, reason) => {
    const file = importFile()
    file.expenses[1].expenseDate = expenseDate
    await expectRejected(JSON.stringify(file), reason)
  })

  it('rejects an expense pointing at a category that does not exist', async () => {
    const file = importFile()
    file.expenses[1].categoryId = 'no-such-category'
    await expectRejected(JSON.stringify(file), /expense 2 .*category that does not exist/i)
  })

  it('rejects duplicate category names, ignoring case and surrounding whitespace', async () => {
    const file = importFile()
    file.categories.push({ id: 'food-again', name: '  FOOD ', ...times(9) })
    await expectRejected(JSON.stringify(file), /more than one category named "Food"/i)
  })

  it('rejects a file with no Other category', async () => {
    const file = importFile()
    file.categories = file.categories.filter((c) => c.id !== 'other')
    await expectRejected(JSON.stringify(file), /no Other category/i)
  })

  it.each([
    ['categories', (f: ReturnType<typeof importFile>) => f.categories.push({ id: 'food', name: 'Groceries', ...times(9) })],
    ['expenses', (f: ReturnType<typeof importFile>) => f.expenses.push({ ...f.expenses[0] })],
  ])('rejects %s that share an id', async (_, duplicate) => {
    const file = importFile()
    duplicate(file)
    await expectRejected(JSON.stringify(file), /share the id/i)
  })

  it('imports deleted records, hides them, and keeps them for the next export', async () => {
    const file = importFile()
    file.categories.push({ id: 'old', name: 'Old', ...times(6, 8) })
    file.expenses.push({ id: 'e3', amount: 100, description: 'Gone', expenseDate: '2026-11-21', categoryId: 'old', ...times(7, 8) })
    const { tracker, repository } = await setup()

    const result = await tracker.importFromJson(JSON.stringify(file))

    expect(result).toEqual({ ok: true, value: { categories: 3, expenses: 2 } })
    for (const t of [tracker, (await setup(repository)).tracker]) {
      expect(t.categories().map((c) => c.name)).toEqual(['Food', 'Books', 'Other'])
      expect(t.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Novel', 'Chai and samosa'])
      expect(JSON.parse(t.exportToJson())).toEqual(file)
    }
  })

  it('lets a live category reuse the name of a deleted one', async () => {
    const file = importFile()
    file.categories.push({ id: 'food-old', name: 'food', ...times(6, 7) })
    const { tracker } = await setup()

    expect((await tracker.importFromJson(JSON.stringify(file))).ok).toBe(true)
  })

  it('rejects a live expense pointing at a deleted category', async () => {
    const file = importFile()
    file.categories[1] = { ...file.categories[1], ...times(2, 6) }
    await expectRejected(JSON.stringify(file), /expense 2 .*deleted category/i)
  })

  it('rejects a file whose Other category is marked deleted', async () => {
    const file = importFile()
    file.categories[2] = { ...file.categories[2], ...times(3, 6) }
    await expectRejected(JSON.stringify(file), /Other category is marked deleted/i)
  })

  it.each([
    ['created', 'createdAt'],
    ['updated', 'updatedAt'],
  ])('rejects a record with no %s time', async (what, field) => {
    const file = importFile()
    delete file.expenses[1][field]
    await expectRejected(JSON.stringify(file), new RegExp(`expense 2 has no ${what} time`, 'i'))
  })

  it.each([
    ['a date only', '2026-11-20'],
    ['no milliseconds', '2026-11-20T10:00:00Z'],
    ['a local time with an offset', '2026-11-20T15:30:00.000+05:30'],
    ['an impossible time', '2026-11-20T25:00:00.000Z'],
    ['a number', 1_790_000_000_000],
  ])('rejects a record time that is %s', async (_, time) => {
    const file = importFile()
    file.categories[1].deletedAt = time
    await expectRejected(JSON.stringify(file), /category 2 has a deleted time that is not a UTC ISO 8601 timestamp/i)
  })

  it('gives version 1 records the import time, a millisecond apart in their order, with nothing deleted', async () => {
    const now = new Date(2026, 10, 24, 10, 0)
    const { tracker } = await setup(createMemoryRepository(), now)

    await tracker.importFromJson(schemaV1Fixture)

    const exported = JSON.parse(tracker.exportToJson())
    const records = [...exported.categories, ...exported.expenses]
    expect(records.map((r) => r.createdAt)).toEqual(records.map((_, i) => new Date(now.getTime() + i).toISOString()))
    expect(records.every((r) => r.updatedAt === r.createdAt && !('deletedAt' in r))).toBe(true)
  })

  it('stamps records added after an import later than every imported record', async () => {
    const file = importFile()
    // Imported times are ahead of this device's clock.
    file.expenses[1] = { ...file.expenses[1], createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z' }
    file.expenses[1].expenseDate = '2026-11-20'
    const { tracker } = await setup()
    await tracker.importFromJson(JSON.stringify(file))

    const added = await addOrFail(tracker, { ...valid, description: 'Added after' })

    expect(added.createdAt > '2027-01-01T00:00:00.000Z').toBe(true)
    expect(tracker.expensesInMonth('2026-11')[0].description).toBe('Added after')
  })
})

/** Record times a few seconds apart on 20 November 2026, as an export file would carry them. */
function times(second: number, deletedSecond?: number) {
  const at = (s: number) => `2026-11-20T10:00:${String(s).padStart(2, '0')}.000Z`
  const recordTimes: Record<string, string> = { createdAt: at(second), updatedAt: at(second) }
  if (deletedSecond !== undefined) recordTimes.updatedAt = recordTimes.deletedAt = at(deletedSecond)
  return recordTimes
}

/** A small, valid import file in the current schema. */
function importFile() {
  return {
    schemaVersion: 2,
    categories: [
      { id: 'food', name: 'Food', ...times(1) },
      { id: 'books', name: 'Books', ...times(2) },
      { id: 'other', name: 'Other', ...times(3) },
    ] as Record<string, unknown>[],
    expenses: [
      { id: 'e1', amount: 1250, description: 'Chai and samosa', expenseDate: '2026-11-20', categoryId: 'food', ...times(4) },
      { id: 'e2', amount: 49900, description: 'Novel', expenseDate: '2026-11-24', categoryId: 'books', ...times(5) },
    ] as Record<string, unknown>[],
  }
}

describe('browsing months', () => {
  it.each([
    ['2026-11', '2026-10', '2026-12'],
    ['2026-01', '2025-12', '2026-02'],
    ['2026-12', '2026-11', '2027-01'],
  ])('steps from %s back to %s and forward to %s', async (month, previous, next) => {
    const { tracker } = await setup()

    expect(tracker.previousMonth(month)).toBe(previous)
    expect(tracker.nextMonth(month)).toBe(next)
  })

  it('counts expenses on the first and last days of a month in that month only', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '1', expenseDate: '2026-09-30' })
    await addOrFail(tracker, { ...valid, amount: '10', expenseDate: '2026-10-01' })
    await addOrFail(tracker, { ...valid, amount: '100', expenseDate: '2026-10-31' })
    await addOrFail(tracker, { ...valid, amount: '1000', expenseDate: '2026-11-01' })

    expect(tracker.monthlyTotal('2026-09')).toBe(100)
    expect(tracker.monthlyTotal('2026-10')).toBe(11000)
    expect(tracker.monthlyTotal('2026-11')).toBe(100000)
  })

  it('counts 29 February in February of a leap year', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '5', expenseDate: '2024-02-29' })

    expect(tracker.monthlyTotal('2024-02')).toBe(500)
    expect(tracker.monthlyTotal('2024-03')).toBe(0)
  })
})

describe('category totals', () => {
  it("gives a category total for each category with expenses in the month, largest first, leaving out the rest", async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '120', categoryId: 'food' })
    await addOrFail(tracker, { ...valid, amount: '30.50', categoryId: 'food' })
    await addOrFail(tracker, { ...valid, amount: '15000', categoryId: 'rent' })
    await addOrFail(tracker, { ...valid, amount: '45', categoryId: 'transport' })
    await addOrFail(tracker, { ...valid, amount: '999', categoryId: 'health', expenseDate: '2026-10-31' })

    expect(tracker.categoryTotals('2026-11')).toEqual([
      { categoryId: 'rent', name: 'Rent', total: 1_500_000 },
      { categoryId: 'food', name: 'Food', total: 15050 },
      { categoryId: 'transport', name: 'Transport', total: 4500 },
    ])
  })

  it('category totals add up exactly to the monthly total', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    await addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'bills' })
    await addOrFail(tracker, { ...valid, amount: '0.01', categoryId: 'other' })
    await addOrFail(tracker, { ...valid, amount: '10000000', categoryId: 'rent' })

    const totals = tracker.categoryTotals('2026-11')

    expect(tracker.monthlyTotal('2026-11')).toBe(1_000_000_031)
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(1_000_000_031)
  })

  it('shows the new name after a rename, and the totals still add up exactly to the monthly total', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    await addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'bills' })
    await tracker.renameCategory('food', 'Groceries')

    const totals = tracker.categoryTotals('2026-11')

    expect(totals).toEqual([
      { categoryId: 'bills', name: 'Bills', total: 20 },
      { categoryId: 'food', name: 'Groceries', total: 10 },
    ])
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(tracker.monthlyTotal('2026-11'))
  })

  it("counts a deleted category's expenses in Other's total, and the totals still add up to the monthly total", async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '0.10', categoryId: 'food' })
    await addOrFail(tracker, { ...valid, amount: '0.20', categoryId: 'other' })
    await addOrFail(tracker, { ...valid, amount: '5', categoryId: 'rent' })
    await tracker.deleteCategory('food')

    const totals = tracker.categoryTotals('2026-11')

    expect(totals).toEqual([
      { categoryId: 'rent', name: 'Rent', total: 500 },
      { categoryId: 'other', name: 'Other', total: 30 },
    ])
    expect(totals.reduce((sum, c) => sum + c.total, 0)).toBe(tracker.monthlyTotal('2026-11'))
  })

  it('gives no category totals for a month with no expenses', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker)

    expect(tracker.monthlyTotal('2026-08')).toBe(0)
    expect(tracker.categoryTotals('2026-08')).toEqual([])
  })
})


describe('sync-ready records', () => {
  it('stamps a new expense with when it was created and last updated', async () => {
    const now = new Date(2026, 10, 24, 10, 0)
    const { tracker } = await setup(createMemoryRepository(), now)

    const expense = await addOrFail(tracker)

    expect(expense.createdAt).toBe(expense.updatedAt)
    expect(Date.parse(expense.createdAt)).toBeGreaterThanOrEqual(now.getTime())
    expect(expense).not.toHaveProperty('deletedAt')
  })

  it('moves updatedAt on an edit and keeps createdAt', async () => {
    const { tracker } = await setup()
    const expense = await addOrFail(tracker)

    const edited = await tracker.editExpense(expense.id, { ...valid, description: 'Edited' })

    expect(edited).toMatchObject({ ok: true, value: { createdAt: expense.createdAt } })
    expect(edited.ok && edited.value.updatedAt > expense.updatedAt).toBe(true)
  })

  it('keeps a deleted expense as a record marked deleted, and refuses to edit or delete it again', async () => {
    const { tracker, repository } = await setup()
    const expense = await addOrFail(tracker)

    const deleted = await tracker.deleteExpense(expense.id)

    expect(deleted).toMatchObject({ ok: true, value: { id: expense.id, deletedAt: expect.any(String) } })
    expect(deleted.ok && deleted.value.updatedAt).toBe(deleted.ok && deleted.value.deletedAt)
    expect((await repository.load())?.expenses).toMatchObject([{ id: expense.id, deletedAt: expect.any(String) }])
    expect(await tracker.editExpense(expense.id, valid)).toMatchObject({ ok: false, error: { field: 'expense' } })
    expect(await tracker.deleteExpense(expense.id)).toMatchObject({ ok: false, error: { field: 'expense' } })
  })

  it('leaves deleted expenses out of totals and category totals', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, amount: '10', categoryId: 'food' })
    const deleted = await addOrFail(tracker, { ...valid, amount: '5', categoryId: 'rent' })
    await tracker.deleteExpense(deleted.id)

    expect(tracker.monthlyTotal('2026-11')).toBe(1000)
    expect(tracker.categoryTotals('2026-11')).toEqual([{ categoryId: 'food', name: 'Food', total: 1000 }])
  })

  it('hides a deleted category everywhere and refuses expenses, renames and deletes for it', async () => {
    const { tracker } = await setup()
    await tracker.deleteCategory('food')

    expect(tracker.categories().map((c) => c.id)).not.toContain('food')
    expect(await tracker.addExpense({ ...valid, categoryId: 'food' })).toMatchObject({ ok: false, error: { field: 'categoryId' } })
    expect(await tracker.renameCategory('food', 'Groceries')).toMatchObject({ ok: false, error: { field: 'category' } })
    expect(await tracker.deleteCategory('food')).toMatchObject({ ok: false, error: { field: 'category' } })
  })

  it('makes a new category, with a new id, when a deleted category’s name is used again', async () => {
    const { tracker } = await setup()
    await tracker.deleteCategory('food')

    const result = await tracker.addCategory('Food')

    expect(result).toMatchObject({ ok: true, value: { name: 'Food' } })
    expect(result.ok && result.value.id).not.toBe('food')
  })

  it('moves only live expenses to Other, leaving deleted ones on the deleted category', async () => {
    const { tracker } = await setup()
    await addOrFail(tracker, { ...valid, categoryId: 'food' })
    const gone = await addOrFail(tracker, { ...valid, categoryId: 'food' })
    await tracker.deleteExpense(gone.id)

    const result = await tracker.deleteCategory('food')

    expect(result).toMatchObject({ ok: true, value: { movedExpenseCount: 1 } })
    const exported = JSON.parse(tracker.exportToJson())
    expect(exported.expenses.find((e: { id: string }) => e.id === gone.id)).toMatchObject({ categoryId: 'food' })
  })

  it('keeps creation order after a reload, even though storage returns records by id', async () => {
    const { tracker, repository } = await setup()
    await tracker.addCategory('Zebra crossings')
    await tracker.addCategory('Apples')
    await addOrFail(tracker, { ...valid, description: 'zzz added first' })
    await addOrFail(tracker, { ...valid, description: 'aaa added second' })

    const { tracker: reloaded } = await setup(repository)

    expect(reloaded.categories().map((c) => c.name)).toEqual([
      'Food',
      'Transport',
      'Rent',
      'Bills',
      'Shopping',
      'Health',
      'Entertainment',
      'Other',
      'Zebra crossings',
      'Apples',
    ])
    expect(reloaded.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['aaa added second', 'zzz added first'])
  })
})

describe('saving', () => {
  it.each([
    ['adding an expense', (t: ExpenseTracker) => t.addExpense({ ...valid, description: 'Not saved' })],
    ['editing an expense', (t: ExpenseTracker) => t.editExpense(t.expensesInMonth('2026-11')[0].id, { ...valid, amount: '1' })],
    ['deleting an expense', (t: ExpenseTracker) => t.deleteExpense(t.expensesInMonth('2026-11')[0].id)],
    ['adding a category', (t: ExpenseTracker) => t.addCategory('Books')],
    ['renaming a category', (t: ExpenseTracker) => t.renameCategory('food', 'Groceries')],
    ['deleting a category', (t: ExpenseTracker) => t.deleteCategory('food')],
    ['importing', (t: ExpenseTracker) => t.importFromJson(JSON.stringify(importFile()))],
  ])('undoes %s when it can’t be saved, and says so', async (_, change) => {
    const { tracker, repository } = await setup()
    await addOrFail(tracker, { ...valid, description: 'Already saved' })
    const before = tracker.exportToJson()
    repository.failWrites = true

    const result = await change(tracker)

    expect(result).toMatchObject({
      ok: false,
      error: { field: 'save', message: expect.stringMatching(/couldn’t be saved.*undone.*Export/) },
    })
    expect(tracker.exportToJson()).toBe(before)
    repository.failWrites = false
    expect((await setup(repository)).tracker.exportToJson()).toBe(before)
  })

  it('carries on saving once saving works again', async () => {
    const { tracker, repository } = await setup()
    repository.failWrites = true
    await tracker.addExpense({ ...valid, description: 'Lost' })
    repository.failWrites = false

    await addOrFail(tracker, { ...valid, description: 'Kept' })

    expect((await setup(repository)).tracker.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Kept'])
  })

  it('saves changes made one after another without waiting, in order', async () => {
    const { tracker, repository } = await setup()

    const results = await Promise.all([
      tracker.addExpense({ ...valid, description: 'First' }),
      tracker.addExpense({ ...valid, description: 'Second' }),
      tracker.addCategory('Books'),
    ])

    expect(results.every((r) => r.ok)).toBe(true)
    const { tracker: reloaded } = await setup(repository)
    expect(reloaded.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Second', 'First'])
    expect(reloaded.categories().map((c) => c.name)).toContain('Books')
  })
})

describe('stored data', () => {
  it('seeds the default categories on first run and stores them straight away', async () => {
    const { repository } = await setup()

    const stored = await repository.load()

    expect(stored?.schemaVersion).toBe(2)
    expect(stored?.categories).toHaveLength(8)
  })

  it('reports stored data that fails validation, with the same reason an import would give, and leaves it stored', async () => {
    const repository = createMemoryRepository()
    const file = importFile()
    file.expenses[1].amount = 12.5
    repository.seed(file)

    const { tracker } = await setup(repository)

    expect(tracker.storedDataProblem()?.message).toMatch(/expense 2 .*amount/i)
    expect(JSON.parse(tracker.storedDataProblem()!.storedText!)).toMatchObject({ schemaVersion: 2 })
    expect((await repository.load())?.expenses).toHaveLength(2)
  })

  it('names the download of unreadable stored data with today’s date', async () => {
    const repository = createMemoryRepository()
    repository.seed({ schemaVersion: 'nonsense', categories: [], expenses: [] })

    const { tracker } = await setup(repository)

    expect(tracker.storedDataProblem()?.fileName).toBe('expense-tracker-unreadable-data-2026-11-24.txt')
  })

  it('loads stored data with an expense dated after today, as when the clock or time zone has moved back', async () => {
    const repository = createMemoryRepository()
    const file = importFile()
    file.expenses[1].expenseDate = '2026-11-25'
    repository.seed(file)

    const { tracker } = await setup(repository)

    expect(tracker.storedDataProblem()).toBeNull()
    expect(tracker.expensesInMonth('2026-11').map((e) => e.expenseDate)).toEqual(['2026-11-25', '2026-11-20'])
  })

  it('reports stored data from a newer schema version rather than guessing at it', async () => {
    const repository = createMemoryRepository()
    repository.seed({ ...importFile(), schemaVersion: 3 })

    const { tracker } = await setup(repository)

    expect(tracker.storedDataProblem()?.message).toMatch(/newer than this app understands/)
  })

  it('reports storage that can’t be opened at all, with nothing to download, and refuses every change', async () => {
    const repository = createMemoryRepository()
    repository.load = () => Promise.reject(new Error('IndexedDB is unavailable'))

    const { tracker } = await setup(repository)

    expect(tracker.storedDataProblem()).toMatchObject({ message: expect.stringMatching(/couldn’t be opened/), storedText: null })
    expect(await tracker.addExpense(valid)).toMatchObject({ ok: false, error: { field: 'storedData' } })
  })

  /** A repository holding unreadable data, as left by a corrupted store. */
  function corruptRepository() {
    const repository = createMemoryRepository()
    repository.seed({ schemaVersion: 2, categories: [{ id: 'food' }], expenses: [] })
    return repository
  }

  it.each([
    ['adding an expense', (t: ExpenseTracker) => t.addExpense(valid)],
    ['editing an expense', (t: ExpenseTracker) => t.editExpense('e1', valid)],
    ['deleting an expense', (t: ExpenseTracker) => t.deleteExpense('e1')],
    ['adding a category', (t: ExpenseTracker) => t.addCategory('Books')],
    ['renaming a category', (t: ExpenseTracker) => t.renameCategory('food', 'Groceries')],
    ['deleting a category', (t: ExpenseTracker) => t.deleteCategory('food')],
    ['importing', (t: ExpenseTracker) => t.importFromJson(JSON.stringify(importFile()))],
  ])('refuses %s while stored data is unreadable, so the stored data is never overwritten', async (_, change) => {
    const repository = corruptRepository()
    const stored = await repository.load()
    const { tracker } = await setup(repository)

    const result = await change(tracker)

    expect(result).toMatchObject({ ok: false, error: { field: 'storedData' } })
    expect(await repository.load()).toEqual(stored)
  })

  it('starts fresh with the default categories only when asked, and keeps working after a reload', async () => {
    const { tracker, repository } = await setup(corruptRepository())

    expect(await tracker.startFresh()).toEqual({ ok: true, value: undefined })

    expect(tracker.storedDataProblem()).toBeNull()
    await addOrFail(tracker, { ...valid, description: 'After starting fresh' })
    const { tracker: reloaded } = await setup(repository)
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

  it('keeps the problem when starting fresh can’t be saved', async () => {
    const { tracker, repository } = await setup(corruptRepository())
    repository.failWrites = true

    expect(await tracker.startFresh()).toMatchObject({ ok: false, error: { field: 'save' } })
    expect(tracker.storedDataProblem()).not.toBeNull()
  })

  it('refuses to start fresh when stored data loaded fine, so good data is never thrown away', async () => {
    const { tracker, repository } = await setup()
    await addOrFail(tracker)
    const before = await repository.load()

    expect(await tracker.startFresh()).toMatchObject({ ok: false, error: { field: 'storedData' } })
    expect(await repository.load()).toEqual(before)
  })
})

describe('upgrading from v1', () => {
  /** Opens a tracker on a device where v1 left `v1Text` in localStorage. */
  async function openWithV1(v1Text: string | null, repository = createMemoryRepository(), storage = fakeStorage()) {
    if (v1Text !== null) storage.setItem(V1_STORAGE_KEY, v1Text)
    const tracker = await openExpenseTracker({
      repository,
      v1Source: createV1LocalStorageSource(() => storage),
      clock: () => new Date(2026, 10, 24, 10, 0),
    })
    return { tracker, repository, storage }
  }

  // Each schema version adds a fixture for the version before it, so data saved by an older app keeps loading.
  it('upgrades version 1 data into the repository and keeps the old key only as a backup', async () => {
    const { tracker, repository, storage } = await openWithV1(schemaV1Fixture)

    expect(tracker.storedDataProblem()).toBeNull()
    expect(tracker.categories().at(-1)).toMatchObject({ id: '3f0c2a7e-5b1d-4c8e-9a6f-1d2e3c4b5a69', name: 'Books' })
    expect(tracker.expensesInMonth('2026-11').map((e) => e.description)).toEqual(['Novel', 'November rent'])
    expect(tracker.monthlyTotal('2026-11')).toBe(2_549_900)
    expect((await setup(repository)).tracker.exportToJson()).toBe(tracker.exportToJson())
    expect(storage.getItem(V1_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(V1_BACKUP_KEY)).toBe(schemaV1Fixture)
  })

  it('never reads version 1 data again once the repository has data', async () => {
    const { tracker, repository, storage } = await openWithV1(schemaV1Fixture)
    const upgraded = tracker.exportToJson()
    storage.setItem(V1_STORAGE_KEY, JSON.stringify({ ...JSON.parse(schemaV1Fixture), expenses: [] }))

    const { tracker: reopened } = await openWithV1(null, repository, storage)

    expect(reopened.exportToJson()).toBe(upgraded)
  })

  it('seeds the default categories when there is no version 1 data', async () => {
    const { tracker } = await openWithV1(null)

    expect(tracker.categories()).toHaveLength(8)
    expect(tracker.storedDataProblem()).toBeNull()
  })

  it('reports version 1 data that can’t be read, offering its text, and changes nothing', async () => {
    const corrupt = '{ "schemaVersion": 1, "categories": ['
    const { tracker, repository, storage } = await openWithV1(corrupt)

    expect(tracker.storedDataProblem()).toMatchObject({ message: expect.stringMatching(/not valid JSON/), storedText: corrupt })
    expect(await repository.load()).toBeNull()
    expect(storage.getItem(V1_STORAGE_KEY)).toBe(corrupt)
  })

  it('changes nothing when the upgrade can’t be saved, and upgrades next time it can', async () => {
    const repository = createMemoryRepository()
    repository.failWrites = true
    const { tracker, storage } = await openWithV1(schemaV1Fixture, repository)

    expect(tracker.storedDataProblem()).toMatchObject({
      message: expect.stringMatching(/couldn’t be moved/),
      storedText: schemaV1Fixture,
    })
    expect(await repository.load()).toBeNull()
    expect(storage.getItem(V1_STORAGE_KEY)).toBe(schemaV1Fixture)

    repository.failWrites = false
    const { tracker: retried } = await openWithV1(null, repository, storage)
    expect(retried.storedDataProblem()).toBeNull()
    expect(retried.monthlyTotal('2026-11')).toBe(2_549_900)
  })
})
