# IndexedDB with sync-ready records

v2 moves stored data from one localStorage key to IndexedDB. There is one object store per kind of record (keyed by `id`) and a `meta` store for the schema version and device-only settings. Every record carries `createdAt`, `updatedAt` and, once deleted, a `deletedAt` marker instead of being removed. IndexedDB is no safer than localStorage, since browsers evict both under the same rules. It gives room for v2's new kinds of record, saves without blocking the main thread, and lets each record be written on its own. The deleted markers and timestamps are there so that v3 sync needs no further migration of stored data or export files. This replaces the localStorage part of ADR-0001. The rest of ADR-0001 (no server, export/import as the only backup, the repository interface) still stands.

## Considered Options

- **Keep localStorage**: simplest, but about 5 MiB, synchronous, and it rewrites everything on every change.
- **One blob in IndexedDB**: a small change from v1, but every edit still rewrites everything, and v3 sync would need records it can address one at a time.
- **Hard deletes**: simpler, but sync can't tell "deleted on the phone" from "never seen on the laptop".

## Consequences

- The app loads every record into memory on start and writes changes through to IndexedDB. Domain logic stays synchronous; only opening the app and saving are asynchronous. A failed write undoes the in-memory change, tells the user, and offers an export.
- Deleted records are hidden everywhere, never purged, and included in export files. Category names are unique among live categories only. Live records reference only live records.
- v1 ids are kept, including the fixed default-category ids (`food`, `other`, …), so the same default category matches across devices.
- Moving from v1: where the installed app shares the browser's storage (Android, desktop Chromium), v1 data is upgraded and written in one transaction, then the old key is renamed to `expense-tracker-v1-backup` and never read again. On iOS, Home Screen apps don't share storage with Safari, so v1 data reaches the installed app only through export then import, and the app prompts for it.
- An older window refuses to save over data from a newer schema. New versions arrive through a "reload" prompt, not `skipWaiting()`.
- The app calls `navigator.storage.persist()` on every start until it is granted. Export is still the only real backup, so the app reminds the user to export after 14 days with unexported changes, or 7 days if persistence is denied.
