# Budgets keep a dated history of amounts

A category budget or overall budget is not a single number. It is stored as a list of amounts, each with the month it starts in, and a month is measured against the latest amount starting on or before it. A removed budget is an entry meaning "no budget from this month". We chose this so that changing a budget never rewrites the past: raising Food from ₹8,000 to ₹10,000 in May must not quietly turn April's "over budget" into "fine", and looking back at past months is a main reason to keep budgets at all.

## Considered Options

- **One amount, applied to every month**: simplest, but every change re-judges all of history.
- **Warnings for the current month only**: avoids the problem by never showing budget state for past months, but takes away the look-back.
- **A separate budget set for each month**: exact, but needs setting up every month, which is too much work for one person whose habits rarely change.

## Consequences

Once budget records exist in stored data and export files, going back to a single amount would lose information, so the history shape has to be kept. Each entry is a sync-ready record under ADR-0003, and amounts are integer minor units under ADR-0002.
