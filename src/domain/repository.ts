import type { ReadOptions } from './schema.ts'
import type { TrackerData } from './types.ts'

/**
 * What loading found: the stored data, checked and upgraded to the current
 * schema (or the default categories on first run), or stored data that could
 * not be read, with why and the stored text exactly as it was found.
 */
export type LoadResult = { ok: true; data: TrackerData } | { ok: false; message: string; storedText: string }

/**
 * The only way the app reaches stored data (ADR-0001), so localStorage can be
 * swapped for IndexedDB or a backend without touching the UI or domain rules.
 */
export interface Repository {
  /**
   * Current data, or the default categories on first run. Stored data goes
   * through the same validation and migration as an import, and is never
   * replaced here when it can't be read.
   */
  load(options: ReadOptions): LoadResult
  save(data: TrackerData): void
}
