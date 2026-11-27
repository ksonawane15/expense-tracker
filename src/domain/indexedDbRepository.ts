import { NewerVersionError, type Repository, type StoredRecords } from './repository.ts'
import { RECORD_KINDS, SCHEMA_VERSION, type RecordKind, type RecordsByKind, type TrackerData } from './types.ts'

const DB_NAME = 'expense-tracker'
/**
 * The IndexedDB version, which is separate from the schema version. Adding a
 * kind of record to RECORD_KINDS needs a new object store, so bump this too:
 * opening at a higher version creates any store that is missing.
 */
const DB_VERSION = 1
const META_STORE = 'meta'
const SCHEMA_VERSION_KEY = 'schemaVersion'
const ALL_STORES = [META_STORE, ...RECORD_KINDS]

/**
 * The repository over IndexedDB (ADR-0003): one object store per kind of
 * record, keyed by `id`, plus a `meta` store holding the schema version. Each
 * write is one transaction, so it lands in full or not at all.
 */
export function createIndexedDbRepository(factory: IDBFactory = globalThis.indexedDB): Repository {
  let connection: Promise<IDBDatabase> | null = null
  /** Set once a newer version of the app has taken over the database; nothing is written after that. */
  let superseded = false

  function open(): Promise<IDBDatabase> {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
        for (const kind of RECORD_KINDS) {
          if (!db.objectStoreNames.contains(kind)) db.createObjectStore(kind, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        // A newer version of the app wants to upgrade the database. Step aside:
        // this window's writes fail from now on rather than block it.
        db.onversionchange = () => {
          superseded = true
          db.close()
        }
        resolve(db)
      }
      // A VersionError means a newer version of the app has already upgraded the database.
      request.onerror = () => reject(request.error?.name === 'VersionError' ? new NewerVersionError() : request.error)
      request.onblocked = () => reject(new Error('The database is blocked by another window of the app.'))
    })
    // A failed open is retried next time rather than remembered.
    connection.catch(() => (connection = null))
    return connection
  }

  /**
   * Runs `work` in one transaction over every store, resolving with its result
   * once the transaction has committed. If `work` throws (for example a record
   * that can't be stored), the transaction is aborted and nothing is written.
   */
  async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    if (superseded) throw new NewerVersionError()
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(ALL_STORES, mode)
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('The save was cancelled.'))
      Promise.resolve()
        .then(() => work(tx))
        .then(
          (value) => (result = value),
          (error: unknown) => {
            reject(error)
            try {
              tx.abort()
            } catch {
              // Already finished or aborted.
            }
          },
        )
    })
  }

  function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  function putAll(tx: IDBTransaction, records: Partial<RecordsByKind>) {
    for (const kind of RECORD_KINDS) {
      const store = tx.objectStore(kind)
      for (const record of records[kind] ?? []) store.put(record)
    }
  }

  /** Refuses the write in progress if a newer version of the app has stored a newer schema. */
  async function refuseIfNewer(tx: IDBTransaction) {
    const stored = await request(tx.objectStore(META_STORE).get(SCHEMA_VERSION_KEY))
    if (typeof stored === 'number' && stored > SCHEMA_VERSION) throw new NewerVersionError()
  }

  function writeEverything(tx: IDBTransaction, data: TrackerData) {
    for (const name of ALL_STORES) tx.objectStore(name).clear()
    tx.objectStore(META_STORE).put(data.schemaVersion, SCHEMA_VERSION_KEY)
    putAll(tx, data)
  }

  return {
    load() {
      return transaction('readonly', async (tx) => {
        const schemaVersion = await request(tx.objectStore(META_STORE).get(SCHEMA_VERSION_KEY))
        const stored = { schemaVersion } as StoredRecords
        for (const kind of RECORD_KINDS) stored[kind] = await request(tx.objectStore(kind).getAll())
        const empty = schemaVersion === undefined && RECORD_KINDS.every((kind: RecordKind) => stored[kind].length === 0)
        return empty ? null : stored
      })
    },

    create(data) {
      return transaction('readwrite', async (tx) => {
        const existing = await request(tx.objectStore(META_STORE).get(SCHEMA_VERSION_KEY))
        if (existing !== undefined) return false
        writeEverything(tx, data)
        return true
      })
    },

    put(records) {
      return transaction('readwrite', async (tx) => {
        await refuseIfNewer(tx)
        putAll(tx, records)
      })
    },

    replaceAll(data) {
      return transaction('readwrite', async (tx) => {
        await refuseIfNewer(tx)
        writeEverything(tx, data)
      })
    },
  }
}
