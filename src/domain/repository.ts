import type { RecordKind, RecordsByKind, TrackerData } from './types.ts'

/**
 * Stored records exactly as found, unchecked: they may be corrupt, or from an
 * older schema. The expense tracker module checks and upgrades them.
 */
export type StoredRecords = { schemaVersion: unknown } & { [K in RecordKind]: unknown[] }

/**
 * The only way the app reaches stored data (ADR-0001, ADR-0003). It only
 * stores and returns records: checking, migrating and choosing defaults are
 * the expense tracker module's job. Every write is all or nothing: if it
 * fails, the promise rejects and nothing it was given has been stored.
 */
export interface Repository {
  /** Everything stored, or `null` when nothing has been stored yet. Rejects if storage can't be opened. */
  load(): Promise<StoredRecords | null>
  /**
   * Stores `data` only if nothing is stored yet, resolving `true`; otherwise
   * changes nothing and resolves `false` (another window got there first).
   */
  create(data: TrackerData): Promise<boolean>
  /** Adds or replaces the given records by `id`, leaving every other record as it is. */
  put(records: Partial<RecordsByKind>): Promise<void>
  /** Replaces everything stored with `data`. */
  replaceAll(data: TrackerData): Promise<void>
}
