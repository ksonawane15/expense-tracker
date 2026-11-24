# Browser-only storage in localStorage

v1 has no backend: all data lives in the browser's `localStorage` under one versioned key (`{ schemaVersion, categories, expenses }`). The app has one user on one device, and avoiding a server means no hosting, login or cost. The trade-off is that data doesn't sync between devices and is lost if site data is cleared. JSON export/import (all or nothing, replacing everything) is therefore the only backup and restore path. That's why it's in scope even though it wasn't asked for at first.

## Consequences

- The UI talks to storage only through a repository interface, so a backend can replace `localStorage` later without changes to the UI.
- `schemaVersion` is on both the stored data and export files. Whenever the data shape changes, a migration has to upgrade older stored data and older export files.
- A few thousand expenses fit easily within `localStorage` limits. If that ever stops being true, move to IndexedDB rather than a server.
