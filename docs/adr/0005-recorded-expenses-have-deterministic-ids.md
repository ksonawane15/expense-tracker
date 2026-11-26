# Recorded expenses have deterministic ids

An expense recorded by a recurring expense gets its id from the recurring expense's id plus the due date, not a random id. The same applies to income recorded by a recurring income. Recording runs on every device and again after every import, and in v3 it will run on devices that sync. With deterministic ids, the same due date always produces the same expense, wherever and however many times it is recorded, so it can never be recorded twice. A recorded expense the user deletes keeps its id with a deleted marker (ADR-0003), so it is never recorded again. Deleting a recorded expense is therefore how you skip one due date.

## Considered Options

- **A "recorded through" date on each recurring expense**: simple, but two devices that each move their own pointer forward both record the same due dates. An import, which replaces the pointer, can also rewind it.
- **Only one device records**: fits "phone is the main copy" today, but needs a per-device setting and breaks once v3 sync arrives.

## Consequences

- The id format becomes part of stored data and export files, so it can't change later without migrating them.
- Finding due dates that need recording means checking each due date from the start date up to today against existing ids, deleted ones included.
