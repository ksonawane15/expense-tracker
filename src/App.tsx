import { useState, type FormEvent } from 'react'
import './App.css'
import { formatExpenseDate, formatMonth } from './domain/calendarDate.ts'
import { createExpenseTracker, type ExpenseTracker, type ValidationError } from './domain/expenseTracker.ts'
import { createLocalStorageRepository } from './domain/localStorageRepository.ts'
import { formatAmount } from './domain/money.ts'

export default function App() {
  const [tracker] = useState(() => createExpenseTracker({ repository: createLocalStorageRepository() }))
  // The tracker owns the data; bumping this re-renders after each change.
  const [, setRevision] = useState(0)
  const month = tracker.currentMonth()
  const expenses = tracker.expensesInMonth(month)
  const categoryNames = new Map(tracker.categories().map((c) => [c.id, c.name]))

  return (
    <main className="app">
      <header>
        <h1>Expenses</h1>
        <p className="month">{formatMonth(month)}</p>
        <p className="monthly-total" aria-label="Monthly total">
          {formatAmount(tracker.monthlyTotal(month))}
        </p>
      </header>

      <AddExpenseForm tracker={tracker} onAdded={() => setRevision((r) => r + 1)} />

      <section aria-labelledby="expenses-heading">
        <h2 id="expenses-heading">This month</h2>
        {expenses.length === 0 ? (
          <p className="empty">No expenses this month yet.</p>
        ) : (
          <ul className="expense-list">
            {expenses.map((e) => (
              <li key={e.id}>
                <span className="expense-date">{formatExpenseDate(e.expenseDate)}</span>
                <span className="expense-description">
                  {e.description}
                  <span className="expense-category">{categoryNames.get(e.categoryId)}</span>
                </span>
                <span className="expense-amount">{formatAmount(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function AddExpenseForm({ tracker, onAdded }: { tracker: ExpenseTracker; onAdded: () => void }) {
  const today = tracker.today()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [expenseDate, setExpenseDate] = useState(today)
  const [categoryId, setCategoryId] = useState(tracker.categories()[0].id)
  const [error, setError] = useState<ValidationError | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = tracker.addExpense({ amount, description, expenseDate, categoryId })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setAmount('')
    setDescription('')
    onAdded()
  }

  const invalid = (field: ValidationError['field']) => error?.field === field || undefined

  return (
    <form className="add-expense" onSubmit={submit} noValidate>
      <h2>Add an expense</h2>
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
      <button type="submit">Add expense</button>
    </form>
  )
}
