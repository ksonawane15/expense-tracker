import { useState, type FormEvent } from 'react'
import './App.css'
import { formatExpenseDate, formatMonth } from './domain/calendarDate.ts'
import { createExpenseTracker, type ExpenseTracker, type ValidationError } from './domain/expenseTracker.ts'
import { createLocalStorageRepository } from './domain/localStorageRepository.ts'
import { formatAmount, toAmountText } from './domain/money.ts'
import type { Expense } from './domain/types.ts'

export default function App() {
  const [tracker] = useState(() => createExpenseTracker({ repository: createLocalStorageRepository() }))
  // The tracker owns the data; bumping this re-renders after each change.
  const [, setRevision] = useState(0)
  const refresh = () => setRevision((r) => r + 1)
  const [editingId, setEditingId] = useState<string | null>(null)
  const month = tracker.currentMonth()
  const expenses = tracker.expensesInMonth(month)
  const categoryNames = new Map(tracker.categories().map((c) => [c.id, c.name]))

  function deleteExpense(expense: Expense) {
    const summary = `${expense.description} (${formatAmount(expense.amount)})`
    if (!window.confirm(`Delete the expense "${summary}"? This can't be undone.`)) return
    // If it was already gone there is nothing to undo; refreshing shows the list as it is.
    tracker.deleteExpense(expense.id)
    if (editingId === expense.id) setEditingId(null)
    refresh()
  }

  return (
    <main className="app">
      <header>
        <h1>Expenses</h1>
        <p className="month">{formatMonth(month)}</p>
        <p className="monthly-total" aria-label="Monthly total">
          {formatAmount(tracker.monthlyTotal(month))}
        </p>
      </header>

      <ExpenseForm tracker={tracker} onSaved={refresh} />

      <section aria-labelledby="expenses-heading">
        <h2 id="expenses-heading">This month</h2>
        {expenses.length === 0 ? (
          <p className="empty">No expenses this month yet.</p>
        ) : (
          <ul className="expense-list">
            {expenses.map((e) =>
              e.id === editingId ? (
                <li key={e.id} className="editing">
                  <ExpenseForm
                    tracker={tracker}
                    expenseToEdit={e}
                    onSaved={() => {
                      setEditingId(null)
                      refresh()
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={e.id}>
                  <span className="expense-date">{formatExpenseDate(e.expenseDate)}</span>
                  <span className="expense-description">
                    {e.description}
                    <span className="expense-category">{categoryNames.get(e.categoryId)}</span>
                  </span>
                  <span className="expense-amount">{formatAmount(e.amount)}</span>
                  <span className="expense-actions">
                    <button type="button" onClick={() => setEditingId(e.id)} aria-label={`Edit ${e.description}`}>
                      Edit
                    </button>
                    <button type="button" className="danger" onClick={() => deleteExpense(e)} aria-label={`Delete ${e.description}`}>
                      Delete
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </main>
  )
}

interface ExpenseFormProps {
  tracker: ExpenseTracker
  /** The expense being edited; omit to add a new one. */
  expenseToEdit?: Expense
  onSaved: () => void
  onCancel?: () => void
}

/** Adds a new expense, or edits `expenseToEdit` in place, under the tracker's validation rules. */
function ExpenseForm({ tracker, expenseToEdit, onSaved, onCancel }: ExpenseFormProps) {
  const today = tracker.today()
  const [amount, setAmount] = useState(expenseToEdit ? toAmountText(expenseToEdit.amount) : '')
  const [description, setDescription] = useState(expenseToEdit?.description ?? '')
  const [expenseDate, setExpenseDate] = useState(expenseToEdit?.expenseDate ?? today)
  const [categoryId, setCategoryId] = useState(expenseToEdit?.categoryId ?? tracker.categories()[0].id)
  const [error, setError] = useState<ValidationError | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const input = { amount, description, expenseDate, categoryId }
    const result = expenseToEdit ? tracker.editExpense(expenseToEdit.id, input) : tracker.addExpense(input)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (!expenseToEdit) {
      setAmount('')
      setDescription('')
    }
    onSaved()
  }

  const invalid = (field: ValidationError['field']) => error?.field === field || undefined

  return (
    <form className="expense-form" onSubmit={submit} noValidate>
      <h2>{expenseToEdit ? 'Edit expense' : 'Add an expense'}</h2>
      <label>
        Amount (₹)
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={invalid('amount')}
        />
      </label>
      <label>
        Description
        <input
          placeholder="What was it for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={invalid('description')}
        />
      </label>
      <label>
        Expense date
        <input
          type="date"
          max={today}
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          aria-invalid={invalid('expenseDate')}
        />
      </label>
      <label>
        Category
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-invalid={invalid('categoryId')}>
          {tracker.categories().map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      <div className="form-actions">
        <button type="submit">{expenseToEdit ? 'Save changes' : 'Add expense'}</button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
