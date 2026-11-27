/**
 * Where v1 kept its data: one localStorage key holding the whole JSON blob
 * (ADR-0001). v2 reads it once, to upgrade it into IndexedDB, then renames the
 * key so it is never read again but is still there as a last-resort copy (ADR-0003).
 */
export interface V1DataSource {
  /** The v1 JSON text exactly as stored, or `null` if there is none (or it can't be reached). */
  load(): string | null
  /** Moves the v1 text to the backup key, so `load` finds nothing from now on. */
  retire(): void
}

export const V1_STORAGE_KEY = 'expense-tracker'
export const V1_BACKUP_KEY = 'expense-tracker-v1-backup'

export function createV1LocalStorageSource(storage: () => Storage = () => window.localStorage): V1DataSource {
  return {
    load() {
      try {
        return storage().getItem(V1_STORAGE_KEY)
      } catch {
        // localStorage can be switched off or throw in private modes: then there is no v1 data to upgrade.
        return null
      }
    },
    retire() {
      try {
        const text = storage().getItem(V1_STORAGE_KEY)
        if (text === null) return
        storage().setItem(V1_BACKUP_KEY, text)
        storage().removeItem(V1_STORAGE_KEY)
      } catch {
        // The upgraded data is already in IndexedDB, which is never empty again, so the old key is never read.
      }
    },
  }
}
