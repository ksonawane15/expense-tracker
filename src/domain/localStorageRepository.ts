import type { Repository } from './repository.ts'
import { readTrackerJson } from './schema.ts'
import { defaultData } from './types.ts'

const STORAGE_KEY = 'expense-tracker'

export function createLocalStorageRepository(storage: Storage = window.localStorage): Repository {
  return {
    load(options) {
      const storedText = storage.getItem(STORAGE_KEY)
      if (storedText === null) return { ok: true, data: defaultData() }
      const read = readTrackerJson(storedText, options)
      if (!read.ok) return { ok: false, message: read.message, storedText }
      // Data upgraded from an older schema version, or carrying fields the
      // schema dropped, is saved back in the current schema so it is upgraded once.
      // It parsed above, so parsing again here can't throw.
      const current = JSON.stringify(read.data)
      if (JSON.stringify(JSON.parse(storedText)) !== current) storage.setItem(STORAGE_KEY, current)
      return read
    },
    save(data) {
      storage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
  }
}
