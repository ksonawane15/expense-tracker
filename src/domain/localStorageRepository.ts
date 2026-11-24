import type { Repository } from './repository.ts'
import { defaultData, type TrackerData } from './types.ts'

const STORAGE_KEY = 'expense-tracker'

export function createLocalStorageRepository(storage: Storage = window.localStorage): Repository {
  return {
    load() {
      const raw = storage.getItem(STORAGE_KEY)
      // Validation and migration of stored data arrive with the import work (#7, #8).
      return raw === null ? defaultData() : (JSON.parse(raw) as TrackerData)
    },
    save(data) {
      storage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
  }
}
