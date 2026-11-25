import type { TrackerData } from './types.ts'

/**
 * The only way the app reaches stored data (ADR-0001), so localStorage can be
 * swapped for IndexedDB or a backend without touching the UI or domain rules.
 * It only stores and returns data: checking, migrating and choosing defaults
 * are the expense tracker module's job.
 */
export interface Repository {
  /**
   * The stored data as JSON text, exactly as stored and unchecked (it may be
   * corrupt, or from an older schema), or `null` on first run when nothing
   * has been stored yet.
   */
  load(): string | null
  /** Persists `data`, replacing whatever was stored. */
  save(data: TrackerData): void
}
