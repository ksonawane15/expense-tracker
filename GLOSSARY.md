# Expense Tracker

A personal app for one person to record what they spend money on, group it by category, and see how much went out each month.

## Language

### Spending

**Expense**:
A single record of money spent: an amount, a description of what it was for, an expense date, and exactly one category.
_Avoid_: Transaction, entry, purchase, item

**Amount**:
How much an expense cost, always positive, held in minor units of the currency.
_Avoid_: Price, cost, value

**Minor units**:
The smallest unit of the currency (paise for INR); ₹12.50 is 1250 minor units.
_Avoid_: Cents, subunits

**Description**:
The short free-text note saying what an expense was for.
_Avoid_: Note, title, memo, name

**Expense date**:
The calendar day the money was spent, with no time of day; never in the future. Not the day the expense was entered.
_Avoid_: Created date, timestamp, entry date

### Grouping

**Category**:
A named bucket that every expense belongs to exactly one of, such as Food or Transport. The user can add, rename and delete categories.
_Avoid_: Tag, label, type

**Default categories**:
The starting set of categories: Food, Transport, Rent, Bills, Shopping, Health, Entertainment, Other.

**Other**:
The fallback category, which can't be deleted. Expenses from a deleted category move here.
_Avoid_: Uncategorised, misc

### Reporting

**Month**:
A calendar month in the user's local time zone; an expense belongs to the month containing its expense date.
_Avoid_: Period, billing cycle

**Monthly total**:
The sum of the amounts of every expense in a month.
_Avoid_: Balance, spend, sum

**Category total**:
The sum of the amounts of a month's expenses in one category.
_Avoid_: Breakdown, subtotal

### Budgets

**Category budget**:
An optional amount the user aims to keep a category total under, which applies from the month it is set until changed; earlier months keep the amount that applied then. A category with no category budget has no warnings; that is different from a budget of zero.
_Avoid_: Limit, cap, allowance

**Overall budget**:
An optional amount the user aims to keep the monthly total under, set separately from the category budgets. Like a category budget, it applies from the month it is set until changed.
_Avoid_: Total budget, monthly limit

**Close to budget**:
The state of a month when its total has reached 80% of the budget but is not more than the budget.
_Avoid_: Nearly over, approaching limit

**Over budget**:
The state of a month when its total is more than the budget.
_Avoid_: Exceeded, overspent, breached

### Recurring

**Recurring expense**:
A rule that records the same expense automatically on a repeating schedule (monthly on a day, weekly on a weekday, or yearly on a date), from a start date until it is stopped or reaches its optional end date. What it records are ordinary expenses; the rule itself is not an expense.
_Avoid_: Template, subscription, schedule, repeating transaction

**Due date**:
A date on which a recurring expense falls, and the expense date of the expense it records then. A day the month doesn't have becomes the month's last day.
_Avoid_: Occurrence, run date, next payment

### Data

**Export**:
A JSON file containing all categories and expenses, used as a backup.
_Avoid_: Backup file, dump

**Import**:
Loading an export file, which replaces all current data; a file with any invalid content is rejected and nothing changes.
_Avoid_: Restore, merge, sync
