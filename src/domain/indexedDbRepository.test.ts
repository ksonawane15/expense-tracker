import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openExpenseTracker } from './expenseTracker.ts'
import schemaV1Fixture from './fixtures/schema-v1.json?raw'
import { createIndexedDbRepository } from './indexedDbRepository.ts'
import type { TrackerData } from './types.ts'
import { createV1LocalStorageSource, V1_BACKUP_KEY, V1_STORAGE_KEY } from './v1LocalStorage.ts'

const at = (second: number) => `2026-11-20T10:00:${String(second).padStart(2, '0')}.000Z`

function sampleData(): TrackerData {
  return {
    schemaVersion: 2,
    categories: [
      { id: 'food', name: 'Food', createdAt: at(1), updatedAt: at(1) },
      { id: 'other', name: 'Other', createdAt: at(2), updatedAt: at(2) },
    ],
    expenses: [
      { id: 'e1', amount: 1250, description: 'Chai', expenseDate: '2026-11-20', categoryId: 'food', createdAt: at(3), updatedAt: at(3) },
    ],
  }
}

/** Writes a schema version straight into the meta store, as a newer app version would. */
function setStoredSchemaVersion(factory: IDBFactory, version: number) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open('expense-tracker')
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put(version, 'schemaVersion')
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

/** A record IndexedDB can't store (functions can't be cloned), to make a write fail part-way. */
const unstorable = { id: 'bad', name: 'Bad', createdAt: at(9), updatedAt: at(9), oops: () => {} } as never

describe('IndexedDB repository', () => {
  it('finds nothing stored on first run', async () => {
    const repository = createIndexedDbRepository(new IDBFactory())

    expect(await repository.load()).toBeNull()
  })

  it('stores data on first run and loads it back, one store per kind of record', async () => {
    const factory = new IDBFactory()
    const data = sampleData()

    expect(await createIndexedDbRepository(factory).create(data)).toBe(true)

    // A second repository over the same database is a reload.
    expect(await createIndexedDbRepository(factory).load()).toEqual(data)
  })

  it('stores first-run data only if nothing is stored yet', async () => {
    const factory = new IDBFactory()
    await createIndexedDbRepository(factory).create(sampleData())

    const second = { ...sampleData(), expenses: [] }

    expect(await createIndexedDbRepository(factory).create(second)).toBe(false)
    expect((await createIndexedDbRepository(factory).load())?.expenses).toHaveLength(1)
  })

  it('adds and replaces records by id, leaving the others alone', async () => {
    const factory = new IDBFactory()
    const repository = createIndexedDbRepository(factory)
    await repository.create(sampleData())
    const renamed = { ...sampleData().categories[0], name: 'Groceries', updatedAt: at(5) }
    const added = { ...sampleData().expenses[0], id: 'e2', createdAt: at(6), updatedAt: at(6) }

    await repository.put({ categories: [renamed], expenses: [added] })

    const stored = await createIndexedDbRepository(factory).load()
    expect(stored?.categories).toEqual([renamed, sampleData().categories[1]])
    expect(stored?.expenses).toEqual([sampleData().expenses[0], added])
  })

  it('writes nothing when one record in a save can’t be stored', async () => {
    const factory = new IDBFactory()
    const repository = createIndexedDbRepository(factory)
    await repository.create(sampleData())
    const renamed = { ...sampleData().categories[0], name: 'Groceries', updatedAt: at(5) }

    await expect(repository.put({ categories: [renamed, unstorable] })).rejects.toThrow()

    expect(await createIndexedDbRepository(factory).load()).toEqual(sampleData())
  })

  it('replaces everything stored', async () => {
    const factory = new IDBFactory()
    const repository = createIndexedDbRepository(factory)
    await repository.create(sampleData())
    const replacement: TrackerData = { ...sampleData(), categories: [sampleData().categories[1]], expenses: [] }

    await repository.replaceAll(replacement)

    expect(await createIndexedDbRepository(factory).load()).toEqual(replacement)
  })

  it('leaves the old data in place when a replacement fails part-way', async () => {
    const factory = new IDBFactory()
    const repository = createIndexedDbRepository(factory)
    await repository.create(sampleData())

    await expect(repository.replaceAll({ ...sampleData(), categories: [unstorable] })).rejects.toThrow()

    expect(await createIndexedDbRepository(factory).load()).toEqual(sampleData())
  })

  it('stores nothing on first run when the data fails part-way', async () => {
    const factory = new IDBFactory()

    await expect(createIndexedDbRepository(factory).create({ ...sampleData(), categories: [unstorable] })).rejects.toThrow()

    expect(await createIndexedDbRepository(factory).load()).toBeNull()
  })
})

describe('the expense tracker over IndexedDB', () => {
  const clock = () => new Date(2026, 10, 24, 10, 0)

  it('keeps changes after a reload', async () => {
    const factory = new IDBFactory()
    const tracker = await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })
    const added = await tracker.addExpense({ amount: '12.50', description: 'Chai', expenseDate: '2026-11-20', categoryId: 'food' })
    await tracker.renameCategory('food', 'Groceries')
    await tracker.deleteCategory('rent')

    const reloaded = await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })

    expect(reloaded.exportToJson()).toBe(tracker.exportToJson())
    expect(reloaded.expensesInMonth('2026-11')).toMatchObject([{ id: added.ok && added.value.id, amount: 1250 }])
  })

  it('undoes a change when this window can no longer write, as when a newer version takes over the database', async () => {
    const factory = new IDBFactory()
    const tracker = await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })
    const before = tracker.exportToJson()
    // A newer version opening the database at a higher version makes this window's connection close.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('expense-tracker', 99)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    const result = await tracker.addExpense({ amount: '1', description: 'Not saved', expenseDate: '2026-11-20', categoryId: 'food' })

    expect(result).toMatchObject({ ok: false, error: { field: 'newerVersion' } })
    expect(tracker.newerVersionFound()).toBe(true)
    expect(tracker.exportToJson()).toBe(before)
  })

  it('refuses a write once a newer version has stored a newer schema version, storing nothing', async () => {
    const factory = new IDBFactory()
    const tracker = await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })
    const before = tracker.exportToJson()
    await setStoredSchemaVersion(factory, 3)

    const result = await tracker.addExpense({ amount: '1', description: 'Not saved', expenseDate: '2026-11-20', categoryId: 'food' })

    expect(result).toMatchObject({ ok: false, error: { field: 'newerVersion' } })
    const stored = await createIndexedDbRepository(factory).load()
    expect(stored?.expenses).toEqual([])
    expect(tracker.exportToJson()).toBe(before)
  })

  it('opens asking to reload when a newer version has already upgraded the database', async () => {
    const factory = new IDBFactory()
    await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })
    await new Promise<void>((resolve) => {
      const request = factory.open('expense-tracker', 99)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })

    const older = await openExpenseTracker({ repository: createIndexedDbRepository(factory), clock })

    expect(older.newerVersionFound()).toBe(true)
    expect(older.storedDataProblem()).toBeNull()
  })

  it('upgrades v1 localStorage data in one go and keeps the old key only as a backup', async () => {
    const factory = new IDBFactory()
    const storage = new Map<string, string>([[V1_STORAGE_KEY, schemaV1Fixture]])
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    } as Storage
    const v1Source = createV1LocalStorageSource(() => fakeStorage)

    const tracker = await openExpenseTracker({ repository: createIndexedDbRepository(factory), v1Source, clock })

    expect(tracker.storedDataProblem()).toBeNull()
    expect(tracker.monthlyTotal('2026-11')).toBe(2_549_900)
    expect(storage.has(V1_STORAGE_KEY)).toBe(false)
    expect(storage.get(V1_BACKUP_KEY)).toBe(schemaV1Fixture)
    const reloaded = await openExpenseTracker({ repository: createIndexedDbRepository(factory), v1Source, clock })
    expect(reloaded.exportToJson()).toBe(tracker.exportToJson())
  })
})
