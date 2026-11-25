import type { Repository } from './repository.ts'

const STORAGE_KEY = 'expense-tracker'

export function createLocalStorageRepository(storage: Storage = window.localStorage): Repository {
  return {
    load() {
      return storage.getItem(STORAGE_KEY)
    },
    save(data) {
      storage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
  }
}
