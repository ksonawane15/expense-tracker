import type { TrackerData } from './types.ts'

/**
 * The only way the app reaches stored data (ADR-0001), so localStorage can be
 * swapped for IndexedDB or a backend without touching the UI or domain rules.
 */
export interface Repository {
  /** Current data, or the default categories on first run. */
  load(): TrackerData
  save(data: TrackerData): void
}
