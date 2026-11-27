import { NewerVersionError, type Repository, type StoredRecords } from './repository.ts'
import { RECORD_KINDS, SCHEMA_VERSION, type RecordsByKind, type TrackerData } from './types.ts'

/**
 * A repository held in memory, for tests. Like IndexedDB, it stores copies, so
 * nothing the app does to its own objects reaches storage without a write.
 * Set `failWrites` to make every write reject and store nothing, as when the
 * browser refuses to save.
 */
export interface MemoryRepository extends Repository {
  failWrites: boolean
  /** Replaces what is stored without any checks, as an earlier app version or a corrupted store might leave it. */
  seed(stored: StoredRecords): void
  /** Sets the stored schema version and nothing else, as a newer app version open in another window would. */
  setStoredSchemaVersion(version: number): void
}

export function createMemoryRepository(): MemoryRepository {
  let schemaVersion: unknown = undefined
  const stores = new Map(RECORD_KINDS.map((kind) => [kind, new Map<string, unknown>()]))

  function write(work: () => void): Promise<void> {
    if (repository.failWrites) return Promise.reject(new Error('Writes are failing.'))
    if (typeof schemaVersion === 'number' && schemaVersion > SCHEMA_VERSION) return Promise.reject(new NewerVersionError())
    work()
    return Promise.resolve()
  }

  function putAll(records: Partial<RecordsByKind>) {
    for (const kind of RECORD_KINDS) {
      for (const record of records[kind] ?? []) stores.get(kind)!.set(record.id, structuredClone(record))
    }
  }

  function replace(data: TrackerData) {
    for (const store of stores.values()) store.clear()
    schemaVersion = data.schemaVersion
    putAll(data)
  }

  const repository: MemoryRepository = {
    failWrites: false,

    seed(stored) {
      schemaVersion = stored.schemaVersion
      for (const kind of RECORD_KINDS) {
        const store = stores.get(kind)!
        store.clear()
        stored[kind].forEach((record, index) => {
          const id = (record as { id?: unknown } | null)?.id
          store.set(typeof id === 'string' ? id : `unkeyed-${index}`, structuredClone(record))
        })
      }
    },

    setStoredSchemaVersion(version) {
      schemaVersion = version
    },

    async load() {
      const empty = schemaVersion === undefined && [...stores.values()].every((store) => store.size === 0)
      if (empty) return null
      const stored = { schemaVersion } as StoredRecords
      // Like IndexedDB, records come back in key order, not the order they were stored in.
      for (const kind of RECORD_KINDS) {
        stored[kind] = [...stores.get(kind)!.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, record]) => structuredClone(record))
      }
      return stored
    },

    async create(data) {
      if (schemaVersion !== undefined) return false
      await write(() => replace(data))
      return true
    },

    put(records) {
      return write(() => putAll(records))
    },

    replaceAll(data) {
      return write(() => replace(data))
    },
  }
  return repository
}
