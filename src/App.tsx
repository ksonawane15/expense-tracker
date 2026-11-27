import { createContext, use, useContext, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { formatExpenseDate, formatMonth } from './domain/calendarDate.ts'
import type { ExpenseTracker, Result, StoredDataProblem, ValidationError } from './domain/expenseTracker.ts'
import { formatAmount, toAmountText } from './domain/money.ts'
import { OTHER_CATEGORY_ID, type Category, type Expense } from './domain/types.ts'
import { reloadToNewestVersion } from './reloadToNewestVersion.ts'
import { UpdatePrompt } from './UpdatePrompt.tsx'

export default function App({ tracker: opening }: { tracker: Promise<ExpenseTracker> }) {
  return (
    <>
      <UpdatePrompt />
      <Screen tracker={use(opening)} />
    </>
  )
}

function Screen({ tracker }: { tracker: ExpenseTracker }) {
  // The tracker owns the data; bumping this re-renders after each change.
  const [, setRevision] = useState(0)
  const refresh = () => setRevision((r) => r + 1)
  // A newer version owns the stored data: this window must not save over it, only reload.
  if (tracker.newerVersionFound()) return <NewerVersionScreen />
  const problem = tracker.storedDataProblem()
  // Nothing that could save is shown until the user has dealt with unreadable stored data.
  if (problem) return <StoredDataProblemScreen tracker={tracker} problem={problem} onStartedFresh={refresh} />
  return <ExpenseTrackerScreen tracker={tracker} refresh={refresh} />
}

function NewerVersionScreen() {
  return (
    <main className="app">
      <section className="data-controls" aria-labelledby="newer-version-heading">
        <h1 id="newer-version-heading">A newer version of the app is in use</h1>
        <p role="alert">
          Another window has updated your data with a newer version of the app, so this window can’t save anything. Your
          data is safe. Reload to use the new version.
        </p>
        <div className="data-actions">
          <button type="button" onClick={() => void reloadToNewestVersion()}>
            Reload
          </button>
        </div>
      </section>
    </main>
  )
}

/** Tells the screen that a change was refused by storage: its save failed, or a newer version owns the data. */
const ChangeRefusedContext = createContext<(field: ValidationError['field']) => void>(() => {})

/** Passes a change's result through, telling the screen when storage refused it. */
function useSaveCheck() {
  const changeRefused = useContext(ChangeRefusedContext)
  return <T,>(result: Result<T>): Result<T> => {
    if (!result.ok && (result.error.field === 'save' || result.error.field === 'newerVersion')) {
      changeRefused(result.error.field)
    }
    return result
  }
}

interface StoredDataProblemScreenProps {
  tracker: ExpenseTracker
  problem: StoredDataProblem
  onStartedFresh: () => void
}

/** Reports stored data that couldn't be read, offers a download of it, and starts fresh only once confirmed. */
function StoredDataProblemScreen({ tracker, problem, onStartedFresh }: StoredDataProblemScreenProps) {
  const [error, setError] = useState<string | null>(null)

  async function startFresh() {
    const confirmed = window.confirm(
      'Start fresh with the default categories and no expenses? Your saved data will be replaced and can’t be ' +
        'recovered here afterwards. Download it first if you want to keep a copy.',
    )
    if (!confirmed) return
    const result = await tracker.startFresh()
    if (!result.ok) {
      setError(result.error.message)
      // A newer version owns the data now: re-rendering switches to its reload screen.
      if (result.error.field === 'newerVersion') onStartedFresh()
      return
    }
    onStartedFresh()
  }

  return (
    <main className="app">
      <section className="data-controls" aria-labelledby="stored-data-heading">
        <h1 id="stored-data-heading">Your saved data couldn’t be read</h1>
        <p role="alert">{problem.message}</p>
        {problem.storedText === null ? (
          <p>Nothing has been changed or deleted. Reload to try again, or start fresh with the default categories.</p>
        ) : (
          <p>
            Nothing has been changed or deleted. Download the saved data to keep a copy you can fix and import later,
            then start fresh with the default categories.
          </p>
        )}
        <div className="data-actions">
          {problem.storedText !== null && (
            <button type="button" onClick={() => downloadFile(problem.storedText!, problem.fileName, 'text/plain')}>
              Download saved data
            </button>
          )}
          <button type="button" className="danger" onClick={startFresh}>
            Start fresh
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}

interface ExpenseTrackerScreenProps {
  tracker: ExpenseTracker
  refresh: () => void
}

function ExpenseTrackerScreen(props: ExpenseTrackerScreenProps) {
  const [saveFailed, setSaveFailed] = useState(false)
  const changeRefused = (field: ValidationError['field']) => {
    if (field === 'save') setSaveFailed(true)
    // A refusal because of a newer version switches the whole app to its reload screen.
    props.refresh()
  }
  return (
    <ChangeRefusedContext value={changeRefused}>
      {saveFailed && (
        <div className="save-failed" role="alert">
          <p>A change couldn’t be saved, so it has been undone. Export your data now to keep a copy of everything saved so far.</p>
          <div className="data-actions">
            <button type="button" onClick={() => downloadExport(props.tracker)}>
              Export now
            </button>
            <button type="button" className="secondary" onClick={() => setSaveFailed(false)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <MonthScreen {...props} />
    </ChangeRefusedContext>
  )
}

function MonthScreen({ tracker, refresh }: ExpenseTrackerScreenProps) {
  const checkSave = useSaveCheck()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [month, setMonth] = useState(() => tracker.currentMonth())
  const expenses = tracker.expensesInMonth(month)
  const categoryTotals = tracker.categoryTotals(month)
  const categoryNames = new Map(tracker.categories().map((c) => [c.id, c.name]))

  async function deleteExpense(expense: Expense) {
    const summary = `${expense.description} (${formatAmount(expense.amount)})`
    if (!window.confirm(`Delete the expense "${summary}"? This can't be undone.`)) return
    // If it was already gone there is nothing to undo; refreshing shows the list as it is.
    const result = checkSave(await tracker.deleteExpense(expense.id))
    if (result.ok && editingId === expense.id) setEditingId(null)
    refresh()
  }

  async function importFile(file: File) {
    const confirmed = window.confirm(
      `Import "${file.name}"? This replaces all your current data, and can't be undone. ` +
        'Export first if you want to keep a copy.',
    )
    if (!confirmed) return
    const result = checkSave(await tracker.importFromJson(await file.text()))
    if (!result.ok) {
      setImportStatus({ ok: false, message: `Nothing was imported. ${result.error.message}` })
      return
    }
    const { categories, expenses } = result.value
    setImportStatus({ ok: true, message: `Imported ${categories} categories and ${expenses} expenses.` })
    setEditingId(null)
    refresh()
  }

  return (
    <main className="app">
      <header>
        <h1>Expenses</h1>
        <nav className="month-switcher" aria-label="Month">
          <button type="button" className="secondary" onClick={() => setMonth(tracker.previousMonth(month))} aria-label="Previous month">
            ‹
          </button>
          <p className="month" aria-live="polite">
            {formatMonth(month)}
          </p>
          <button type="button" className="secondary" onClick={() => setMonth(tracker.nextMonth(month))} aria-label="Next month">
            ›
          </button>
        </nav>
        <p className="monthly-total" aria-label="Monthly total">
          {formatAmount(tracker.monthlyTotal(month))}
        </p>
      </header>

      <section aria-labelledby="category-totals-heading">
        <h2 id="category-totals-heading">By category</h2>
        {categoryTotals.length === 0 ? (
          <p className="empty">No expenses in {formatMonth(month)}.</p>
        ) : (
          <ul className="category-totals">
            {categoryTotals.map((c) => (
              <li key={c.categoryId}>
                <span className="category-name">{c.name}</span>
                <span className="category-total">{formatAmount(c.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExpenseForm tracker={tracker} onSaved={refresh} />

      <section aria-labelledby="expenses-heading">
        <h2 id="expenses-heading">Expenses in {formatMonth(month)}</h2>
        {expenses.length === 0 ? (
          <p className="empty">Nothing recorded for this month.</p>
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

      <CategoryManager tracker={tracker} onChanged={refresh} />

      <section className="data-controls" aria-labelledby="data-heading">
        <h2 id="data-heading">Your data</h2>
        <p>Your data is saved only in this browser. Export it to a file to keep a backup.</p>
        <div className="data-actions">
          <button type="button" onClick={() => downloadExport(tracker)}>
            Export
          </button>
          <button type="button" onClick={() => importInput.current?.click()}>
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so choosing the same file again still triggers an import.
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </div>
        {importStatus && (
          <p className={importStatus.ok ? 'import-status' : 'import-status error'} role={importStatus.ok ? 'status' : 'alert'}>
            {importStatus.message}
          </p>
        )}
      </section>
    </main>
  )
}

interface CategoryManagerProps {
  tracker: ExpenseTracker
  onChanged: () => void
}

/** Adds, renames and deletes categories; a delete moves its expenses to Other after confirmation. */
function CategoryManager({ tracker, onChanged }: CategoryManagerProps) {
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<ValidationError | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const checkSave = useSaveCheck()

  async function add(event: FormEvent) {
    event.preventDefault()
    const result = checkSave(await tracker.addCategory(newName))
    if (!result.ok) {
      setAddError(result.error)
      return
    }
    setAddError(null)
    setNewName('')
    onChanged()
  }

  function startRename(category: Category) {
    setRenamingId(category.id)
    setRenameText(category.name)
    setRowError(null)
  }

  async function saveRename(event: FormEvent, id: string) {
    event.preventDefault()
    const result = checkSave(await tracker.renameCategory(id, renameText))
    if (!result.ok) {
      setRowError({ id, message: result.error.message })
      return
    }
    setRenamingId(null)
    setRowError(null)
    onChanged()
  }

  async function remove(category: Category) {
    const moved = tracker.expensesMovedOnDelete(category.id)
    const other = tracker.otherCategoryName()
    const consequence =
      moved === 0
        ? 'No expenses will move.'
        : `${moved} ${moved === 1 ? 'expense' : 'expenses'} will move to ${other}.`
    if (!window.confirm(`Delete the category "${category.name}"? ${consequence}`)) return
    const result = checkSave(await tracker.deleteCategory(category.id))
    setRowError(result.ok ? null : { id: category.id, message: result.error.message })
    if (renamingId === category.id) setRenamingId(null)
    onChanged()
  }

  return (
    <section aria-labelledby="categories-heading" className="category-manager">
      <h2 id="categories-heading">Categories</h2>
      <ul className="category-list">
        {tracker.categories().map((c) => (
          <li key={c.id}>
            {c.id === renamingId ? (
              <form className="category-rename" onSubmit={(e) => saveRename(e, c.id)} noValidate>
                <input
                  aria-label={`New name for ${c.name}`}
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  aria-invalid={rowError?.id === c.id || undefined}
                  autoFocus
                />
                <button type="submit">Save</button>
                <button type="button" className="secondary" onClick={() => setRenamingId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="category-name">{c.name}</span>
                <span className="expense-actions">
                  <button type="button" onClick={() => startRename(c)} aria-label={`Rename ${c.name}`}>
                    Rename
                  </button>
                  {c.id !== OTHER_CATEGORY_ID && (
                    <button type="button" className="danger" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>
                      Delete
                    </button>
                  )}
                </span>
              </>
            )}
            {rowError?.id === c.id && (
              <p className="error" role="alert">
                {rowError.message}
              </p>
            )}
          </li>
        ))}
      </ul>
      <form className="category-add" onSubmit={add} noValidate>
        <input
          aria-label="New category name"
          placeholder="New category"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-invalid={addError !== null || undefined}
        />
        <button type="submit">Add category</button>
        {addError && (
          <p className="error" role="alert">
            {addError.message}
          </p>
        )}
      </form>
    </section>
  )
}

/** Saves the tracker's export as a JSON file; the tracker decides its content and name. */
function downloadExport(tracker: ExpenseTracker) {
  downloadFile(tracker.exportToJson(), tracker.exportFileName(), 'application/json')
}

function downloadFile(text: string, fileName: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
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
  const [chosenCategoryId, setCategoryId] = useState(expenseToEdit?.categoryId ?? tracker.categories()[0].id)
  // If the chosen category has since been deleted, its expenses went to Other, so the form follows.
  const categoryId = tracker.categories().some((c) => c.id === chosenCategoryId) ? chosenCategoryId : OTHER_CATEGORY_ID
  const [error, setError] = useState<ValidationError | null>(null)
  const checkSave = useSaveCheck()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const input = { amount, description, expenseDate, categoryId }
    const result = checkSave(await (expenseToEdit ? tracker.editExpense(expenseToEdit.id, input) : tracker.addExpense(input)))
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
