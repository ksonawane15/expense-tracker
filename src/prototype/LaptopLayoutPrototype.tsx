// PROTOTYPE, throwaway: "Prototype the laptop wide-screen layout and charts" (issue #20).
// Three structurally different laptop month views, switchable via `?variant=A|B|C` on the app's
// only route (`/`). Without `?variant=` the real v1 app renders. Data is made up and in memory
// (see laptopPrototypeData.ts); reloading resets it. Shown only in dev builds (main.tsx).
//
// A: Dashboard: three columns (budgets | list with an inline entry row | charts).
// B: Ledger: a full-width spreadsheet table with a typing row, plus a tabbed side panel.
// C: Report: a command line for entry, charts on top that carry the budget colours, lists below.
import { useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { formatAmount, parseAmount } from '../domain/money.ts'
import './laptopPrototype.css'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  TODAY,
  addDays,
  categoryName,
  formatDay,
  formatMonthLabel,
  monthOf,
  nextDueDate,
  paymentMethodName,
  shiftMonth,
  usePrototypeStore,
  type MonthFigures,
  type PrototypeStore,
} from './laptopPrototypeData.ts'
import {
  BudgetMeter,
  CategoryBarsChart,
  ChartLegend,
  ExpenseMeta,
  KeyHint,
  MonthVsLastChart,
  NoticeBar,
  PrototypeSwitcher,
  RecurringManager,
  RecurringMark,
  SavingsFigure,
  StateDot,
  TwelveMonthChart,
  matchByPrefix,
  useShortcuts,
} from './laptopPrototypeShared.tsx'

const VARIANTS = [
  { key: 'A', name: 'Dashboard, 3 columns' },
  { key: 'B', name: 'Ledger table + side panel' },
  { key: 'C', name: 'Report + command line' },
]

export default function LaptopLayoutPrototype() {
  const [variant, setVariant] = useState(() => new URLSearchParams(location.search).get('variant') ?? 'A')
  const store = usePrototypeStore()
  function change(key: string) {
    const params = new URLSearchParams(location.search)
    params.set('variant', key)
    history.replaceState(null, '', `?${params}`)
    setVariant(key)
  }
  return (
    <div className="p-root">
      <NoticeBar store={store} />
      {variant === 'A' && <VariantA store={store} />}
      {variant === 'B' && <VariantB store={store} />}
      {variant === 'C' && <VariantC store={store} />}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
    </div>
  )
}

// ====================================================================================
// Shared header pieces (kept tiny on purpose: each variant owns its layout)
// ====================================================================================

function MonthNav({ store }: { store: PrototypeStore }) {
  const atCurrent = store.month >= monthOf(TODAY)
  return (
    <nav className="p-month-nav" aria-label="Month">
      <button type="button" onClick={() => store.setMonth(shiftMonth(store.month, -1))} aria-label="Previous month" title="Previous month ([)">
        ‹
      </button>
      <span className="p-month-label">{formatMonthLabel(store.month)}</span>
      <button type="button" onClick={() => store.setMonth(shiftMonth(store.month, 1))} disabled={atCurrent} aria-label="Next month" title="Next month (])">
        ›
      </button>
      {!atCurrent && (
        <button type="button" className="p-link" onClick={() => store.setMonth(monthOf(TODAY))}>
          This month
        </button>
      )}
    </nav>
  )
}

function useMonthKeys(store: PrototypeStore, extra: Record<string, () => void>) {
  useShortcuts({
    '[': () => store.setMonth(shiftMonth(store.month, -1)),
    ']': () => store.month < monthOf(TODAY) && store.setMonth(shiftMonth(store.month, 1)),
    ...extra,
  })
}

function BudgetToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="p-toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> Show budgets on charts
    </label>
  )
}

// ====================================================================================
// Variant A: Dashboard, three columns
// ====================================================================================

function VariantA({ store }: { store: PrototypeStore }) {
  const f = store.figures
  const [tab, setTab] = useState<'expenses' | 'income' | 'recurring'>('expenses')
  const [showBudgets, setShowBudgets] = useState(true)
  const amountRef = useRef<HTMLInputElement>(null)
  useMonthKeys(store, {
    n: () => {
      setTab('expenses')
      setTimeout(() => amountRef.current?.focus())
    },
    i: () => setTab('income'),
    r: () => setTab('recurring'),
    e: () => setTab('expenses'),
  })
  const budgeted = f.categories.filter((c) => c.budget !== null)
  const unbudgeted = f.categories.filter((c) => c.budget === null && c.total > 0)

  return (
    <main className="pa">
      <header className="pa-header">
        <h1>Expenses</h1>
        <MonthNav store={store} />
        <dl className="pa-summary">
          <div>
            <dt>Monthly income</dt>
            <dd className="p-num">{f.income.length ? formatAmount(f.monthlyIncome) : '—'}</dd>
          </div>
          <div>
            <dt>Monthly total</dt>
            <dd className="p-num">{formatAmount(f.total)}</dd>
          </div>
          <div>
            <dt>Savings</dt>
            <dd className="p-num">
              <SavingsFigure figures={f} />
            </dd>
          </div>
        </dl>
      </header>

      <aside className="pa-left">
        <h2>Budgets</h2>
        <BudgetMeter label="Overall" total={f.total} budget={f.overallBudget} state={f.overallState} />
        {budgeted.map((c) => (
          <BudgetMeter key={c.id} label={c.name} total={c.total} budget={c.budget} state={c.state} size="small" />
        ))}
        {unbudgeted.length > 0 && (
          <>
            <h3>No budget</h3>
            <ul className="pa-plain-totals">
              {unbudgeted.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <span className="p-num">{formatAmount(c.total)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <section className="pa-center">
        <div className="p-tabs" role="tablist">
          {(['expenses', 'income', 'recurring'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'expenses' ? `Expenses (${f.expenses.length})` : t === 'income' ? `Income (${f.income.length})` : 'Recurring'}{' '}
              <KeyHint>{t[0]}</KeyHint>
            </button>
          ))}
        </div>
        {tab === 'expenses' && (
          <>
            <InlineExpenseRow store={store} amountRef={amountRef} />
            <ul className="pa-list">
              {f.expenses.map((e) => (
                <li key={e.id}>
                  <span className="p-date">{formatDay(e.expenseDate)}</span>
                  <span className="pa-desc">
                    {e.description}
                    <ExpenseMeta expense={e} />
                  </span>
                  <span className="p-num">{formatAmount(e.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {tab === 'income' && <IncomePanel store={store} figures={f} />}
        {tab === 'recurring' && <RecurringManager store={store} />}
      </section>

      <aside className="pa-right">
        <div className="pa-right-head">
          <h2>Charts</h2>
          <BudgetToggle on={showBudgets} set={setShowBudgets} />
        </div>
        <figure>
          <figcaption>By category</figcaption>
          <CategoryBarsChart rows={f.categories} showBudgets={showBudgets} width={390} />
          {showBudgets && <ChartLegend items={[{ label: 'On track' }, { label: 'Close', color: 'var(--p-warn)' }, { label: 'Over', color: 'var(--danger)' }, { label: 'Budget', dashed: true }]} />}
        </figure>
        <figure>
          <figcaption>Last 12 months (click a month)</figcaption>
          <TwelveMonthChart trend={f.trend} showBudgets={showBudgets} showIncome selected={store.month} onSelect={store.setMonth} width={390} height={170} />
          <ChartLegend items={[{ label: 'Spent' }, { label: 'Income', color: 'var(--p-income)' }, ...(showBudgets ? [{ label: 'Overall budget', dashed: true }] : [])]} />
        </figure>
        <figure>
          <figcaption>vs {formatMonthLabel(shiftMonth(store.month, -1))}</figcaption>
          <MonthVsLastChart rows={f.categories} month={store.month} width={390} />
          <ChartLegend items={[{ label: 'This month' }, { label: 'Last month', color: 'var(--p-muted-bar)' }]} />
        </figure>
      </aside>
      <footer className="p-keys">
        <KeyHint>n</KeyHint> new expense · <KeyHint>Enter</KeyHint> save · <KeyHint>Tab</KeyHint> next field · <KeyHint>[</KeyHint>
        <KeyHint>]</KeyHint> month · <KeyHint>e</KeyHint>/<KeyHint>i</KeyHint>/<KeyHint>r</KeyHint> tabs
      </footer>
    </main>
  )
}

/** A one-line add row: amount, description, category by prefix, payment method by prefix, date. */
function InlineExpenseRow({ store, amountRef }: { store: PrototypeStore; amountRef: RefObject<HTMLInputElement | null> }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [payment, setPayment] = useState('')
  const [date, setDate] = useState(TODAY)
  const [error, setError] = useState<string | null>(null)
  const cat = matchByPrefix(CATEGORIES, category)
  const pm = matchByPrefix(PAYMENT_METHODS, payment)

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed.ok) return setError(parsed.message)
    if (!description.trim()) return setError('Add a description.')
    if (!cat) return setError('Type the start of a category, like "fo" for Food.')
    store.addExpense({ amount: parsed.minorUnits, description: description.trim(), expenseDate: date, categoryId: cat.id, paymentMethodId: pm?.id ?? null })
    setAmount('')
    setDescription('')
    setError(null)
    amountRef.current?.focus()
  }

  return (
    <form className="pa-entry" onSubmit={submit} noValidate onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLElement).blur()}>
      <input ref={amountRef} placeholder="₹ amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
      <span className="pa-prefix">
        <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" />
        {category && <span className={cat ? 'pa-resolved' : 'pa-resolved p-error'}>{cat ? `→ ${cat.name}` : 'no match'}</span>}
      </span>
      <span className="pa-prefix">
        <input placeholder="Paid by (optional)" value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment method" />
        {payment && <span className={pm ? 'pa-resolved' : 'pa-resolved p-error'}>{pm ? `→ ${pm.name}` : 'no match'}</span>}
      </span>
      <input type="date" value={date} max={TODAY} onChange={(e) => setDate(e.target.value)} aria-label="Expense date" />
      <button type="submit" className="p-btn">
        Add <KeyHint>↵</KeyHint>
      </button>
      {error && <p className="p-error pa-entry-error">{error}</p>}
    </form>
  )
}

function IncomePanel({ store, figures }: { store: PrototypeStore; figures: MonthFigures }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(TODAY)
  const [error, setError] = useState<string | null>(null)
  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed.ok) return setError(parsed.message)
    if (!description.trim()) return setError('Add a description.')
    store.addIncome({ amount: parsed.minorUnits, description: description.trim(), incomeDate: date })
    setAmount('')
    setDescription('')
    setError(null)
  }
  return (
    <>
      <form className="pa-entry pa-entry-income" onSubmit={submit} noValidate>
        <input placeholder="₹ amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Income amount" autoFocus />
        <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Income description" />
        <input type="date" value={date} max={TODAY} onChange={(e) => setDate(e.target.value)} aria-label="Income date" />
        <button type="submit" className="p-btn">
          Add income
        </button>
        {error && <p className="p-error pa-entry-error">{error}</p>}
      </form>
      {figures.income.length === 0 ? (
        <p className="p-muted p-empty">No income in {formatMonthLabel(figures.month)}, so there is no savings figure for this month.</p>
      ) : (
        <ul className="pa-list">
          {figures.income.map((i) => (
            <li key={i.id}>
              <span className="p-date">{formatDay(i.incomeDate)}</span>
              <span className="pa-desc">
                {i.description}
                <span className="p-meta">
                  <RecurringMark expense={i} />
                </span>
              </span>
              <span className="p-num p-positive">+{formatAmount(i.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ====================================================================================
// Variant B: Ledger table + tabbed side panel
// ====================================================================================

type LedgerRow =
  | { type: 'expense'; id: string; date: string; description: string; category: string; payment: string | null; amount: number; recurring: boolean }
  | { type: 'income'; id: string; date: string; description: string; category: null; payment: null; amount: number; recurring: boolean }

function VariantB({ store }: { store: PrototypeStore }) {
  const f = store.figures
  const [panel, setPanel] = useState<'summary' | 'charts' | 'recurring'>('summary')
  const [showBudgets, setShowBudgets] = useState(false)
  const [filter, setFilter] = useState<'all' | 'expense' | 'income'>('all')
  const firstCell = useRef<HTMLInputElement>(null)
  useMonthKeys(store, {
    n: () => firstCell.current?.focus(),
    '1': () => setPanel('summary'),
    '2': () => setPanel('charts'),
    '3': () => setPanel('recurring'),
  })
  const rows: LedgerRow[] = [
    ...f.expenses.map((e) => ({ type: 'expense' as const, id: e.id, date: e.expenseDate, description: e.description, category: categoryName(e.categoryId), payment: paymentMethodName(e.paymentMethodId), amount: e.amount, recurring: !!e.recurringId })),
    ...f.income.map((i) => ({ type: 'income' as const, id: i.id, date: i.incomeDate, description: i.description, category: null, payment: null, amount: i.amount, recurring: !!i.recurringId })),
  ]
    .filter((r) => filter === 'all' || r.type === filter)
    .sort((a, b) => b.date.localeCompare(a.date))
  const catState = new Map(f.categories.map((c) => [c.name, c.state]))

  return (
    <main className="pb">
      <section className="pb-main">
        <header className="pb-header">
          <MonthNav store={store} />
          <div className="pb-filter" role="radiogroup" aria-label="Show">
            {(['all', 'expense', 'income'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'all' ? 'All' : k === 'expense' ? 'Expenses' : 'Income'}
              </button>
            ))}
          </div>
          <span className="pb-status p-num">
            Spent <strong>{formatAmount(f.total)}</strong>
            {f.overallState && f.overallState !== 'ok' && <StateDot state={f.overallState} />}
            {' · '}In <strong>{f.income.length ? formatAmount(f.monthlyIncome) : '—'}</strong>
            {' · '}Savings <SavingsFigure figures={f} />
          </span>
        </header>
        <table className="pb-table">
          <thead>
            <tr>
              <th style={{ width: '6.5em' }}>Date</th>
              <th style={{ width: '5.5em' }}>Type</th>
              <th>Description</th>
              <th style={{ width: '11em' }}>Category</th>
              <th style={{ width: '8em' }}>Paid by</th>
              <th style={{ width: '9em' }} className="p-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <LedgerEntryRow store={store} firstCell={firstCell} />
            {rows.map((r) => (
              <tr key={r.id} className={r.type === 'income' ? 'pb-income' : ''}>
                <td className="p-date">{formatDay(r.date)}</td>
                <td>{r.type === 'income' ? 'Income' : 'Expense'}</td>
                <td>
                  {r.description} {r.recurring && <RecurringMark expense={{ recurringId: 'x' }} />}
                </td>
                <td>
                  {r.category}
                  {r.category && <StateDot state={catState.get(r.category) ?? null} />}
                </td>
                <td className="p-muted">{r.payment ?? (r.type === 'expense' ? '—' : '')}</td>
                <td className={r.type === 'income' ? 'p-right p-num p-positive' : 'p-right p-num'}>
                  {r.type === 'income' ? '+' : ''}
                  {formatAmount(r.amount)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-muted p-empty">
                  Nothing recorded for {formatMonthLabel(f.month)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <footer className="p-keys">
          <KeyHint>n</KeyHint> jump to entry row · <KeyHint>Tab</KeyHint> next cell · <KeyHint>Enter</KeyHint> save, stay in row · Type <KeyHint>i</KeyHint> in Type for
          income · <KeyHint>1</KeyHint>
          <KeyHint>2</KeyHint>
          <KeyHint>3</KeyHint> panel · <KeyHint>[</KeyHint>
          <KeyHint>]</KeyHint> month
        </footer>
      </section>

      <aside className="pb-panel">
        <div className="p-tabs" role="tablist">
          {(['summary', 'charts', 'recurring'] as const).map((t, i) => (
            <button key={t} role="tab" aria-selected={panel === t} onClick={() => setPanel(t)}>
              {t[0].toUpperCase() + t.slice(1)} <KeyHint>{i + 1}</KeyHint>
            </button>
          ))}
        </div>
        {panel === 'summary' && (
          <div className="pb-summary">
            <BudgetMeter label="Monthly total" total={f.total} budget={f.overallBudget} state={f.overallState} />
            <table className="pb-budget-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="p-right">Spent</th>
                  <th className="p-right">Budget</th>
                  <th className="p-right">Left</th>
                </tr>
              </thead>
              <tbody>
                {f.categories.map((c) => (
                  <tr key={c.id} className={c.state ? `p-state-${c.state}` : ''}>
                    <td>
                      {c.name} <StateDot state={c.state} />
                    </td>
                    <td className="p-right p-num">{formatAmount(c.total)}</td>
                    <td className="p-right p-num p-muted">{c.budget === null ? '—' : formatAmount(c.budget)}</td>
                    <td className="p-right p-num">{c.budget === null ? '' : c.budget >= c.total ? formatAmount(c.budget - c.total) : <strong>−{formatAmount(c.total - c.budget)}</strong>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="pb-income-sum">
              <div>
                <dt>Monthly income</dt>
                <dd className="p-num">{f.income.length ? formatAmount(f.monthlyIncome) : 'No income this month'}</dd>
              </div>
              <div>
                <dt>Monthly total</dt>
                <dd className="p-num">−{formatAmount(f.total)}</dd>
              </div>
              <div className="pb-savings">
                <dt>Savings</dt>
                <dd className="p-num">
                  <SavingsFigure figures={f} />
                </dd>
              </div>
            </dl>
          </div>
        )}
        {panel === 'charts' && (
          <div className="pb-charts">
            <BudgetToggle on={showBudgets} set={setShowBudgets} />
            <figure>
              <figcaption>By category</figcaption>
              <CategoryBarsChart rows={f.categories} showBudgets={showBudgets} width={360} />
            </figure>
            <figure>
              <figcaption>12 months: spent vs income</figcaption>
              <TwelveMonthChart trend={f.trend} showBudgets={showBudgets} showIncome selected={store.month} onSelect={store.setMonth} width={360} height={160} />
              <ChartLegend items={[{ label: 'Spent' }, { label: 'Income', color: 'var(--p-income)' }]} />
            </figure>
            <figure>
              <figcaption>vs last month</figcaption>
              <MonthVsLastChart rows={f.categories} month={store.month} width={360} />
            </figure>
          </div>
        )}
        {panel === 'recurring' && <RecurringManager store={store} dense />}
      </aside>
    </main>
  )
}

/** The typing row at the top of the ledger: same columns as the table, Tab across, Enter saves. */
function LedgerEntryRow({ store, firstCell }: { store: PrototypeStore; firstCell: RefObject<HTMLInputElement | null> }) {
  const [date, setDate] = useState(formatDay(TODAY))
  const [type, setType] = useState('e')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [payment, setPayment] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isIncome = type.trim().toLowerCase().startsWith('i')
  const cat = matchByPrefix(CATEGORIES, category)
  const pm = matchByPrefix(PAYMENT_METHODS, payment)

  function parseDate(text: string): string | null {
    const t = text.trim().toLowerCase()
    if (t === '' || t === 'today' || t === 't') return TODAY
    if (t === 'y' || t === 'yesterday') return addDays(TODAY, -1)
    const m = /^(\d{1,2})(?:\s*(\w+))?$/.exec(t)
    if (!m) return null
    const month = monthOf(TODAY)
    const d = `${month}-${m[1].padStart(2, '0')}`
    return d <= TODAY ? d : null
  }

  function save() {
    const parsed = parseAmount(amount)
    const d = parseDate(date)
    if (!d) return setError('Date: a day of this month like 21, or "y" for yesterday.')
    if (!parsed.ok) return setError(parsed.message)
    if (!description.trim()) return setError('Add a description.')
    if (isIncome) store.addIncome({ amount: parsed.minorUnits, description: description.trim(), incomeDate: d })
    else {
      if (!cat) return setError('Type the start of a category.')
      store.addExpense({ amount: parsed.minorUnits, description: description.trim(), expenseDate: d, categoryId: cat.id, paymentMethodId: pm?.id ?? null })
    }
    setDescription('')
    setAmount('')
    setError(null)
    firstCell.current?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') (e.target as HTMLElement).blur()
  }

  return (
    <>
      <tr className="pb-entry" onKeyDown={onKey}>
        <td>
          <input ref={firstCell} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" onFocus={(e) => e.target.select()} />
        </td>
        <td>
          <input value={isIncome ? 'Income' : type === 'e' ? 'Expense' : type} onChange={(e) => setType(e.target.value.slice(-1))} aria-label="Type (e or i)" onFocus={(e) => e.target.select()} />
        </td>
        <td>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Type to add…" aria-label="Description" />
        </td>
        <td>
          <input value={isIncome ? '' : category} disabled={isIncome} onChange={(e) => setCategory(e.target.value)} aria-label="Category" placeholder={isIncome ? '' : 'fo → Food'} />
          {!isIncome && category && <span className="pb-hint">{cat ? cat.name : 'no match'}</span>}
        </td>
        <td>
          <input value={isIncome ? '' : payment} disabled={isIncome} onChange={(e) => setPayment(e.target.value)} aria-label="Payment method" />
          {!isIncome && payment && <span className="pb-hint">{pm ? pm.name : 'no match'}</span>}
        </td>
        <td>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="p-right" inputMode="decimal" aria-label="Amount" placeholder="0.00" />
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} className="p-error">
            {error}
          </td>
        </tr>
      )}
    </>
  )
}

// ====================================================================================
// Variant C: Report + command line
// ====================================================================================

interface Parsed {
  kind: 'expense' | 'income'
  amount: number | null
  amountError?: string
  description: string
  categoryId: string | null
  paymentMethodId: string | null
  date: string
}

/**
 * "250 lunch food upi y" → ₹250, Lunch, Food, UPI, yesterday. "+8000 freelance" → income.
 * Category / payment method: a whole word that starts a name (3+ letters), or #food / @upi.
 * Date: today by default, "y" or "yesterday", or "21" style day-of-month after the amount.
 */
function parseCommand(text: string): Parsed {
  const out: Parsed = { kind: 'expense', amount: null, description: '', categoryId: null, paymentMethodId: null, date: TODAY }
  const words: string[] = []
  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    const w = raw.toLowerCase()
    if (out.amount === null && /^\+?₹?\d+(\.\d+)?$/.test(w)) {
      if (w.startsWith('+')) out.kind = 'income'
      const p = parseAmount(w.replace(/^\+?₹?/, ''))
      if (p.ok) out.amount = p.minorUnits
      else out.amountError = p.message
      continue
    }
    if (w === 'y' || w === 'yesterday') {
      out.date = addDays(TODAY, -1)
      continue
    }
    if (out.amount !== null && /^\d{1,2}$/.test(w) && Number(w) >= 1 && Number(w) <= Number(TODAY.slice(8))) {
      out.date = `${monthOf(TODAY)}-${w.padStart(2, '0')}`
      continue
    }
    const sig = w[0] === '#' ? 'cat' : w[0] === '@' ? 'pm' : null
    const bare = sig ? w.slice(1) : w
    if ((sig === 'cat' || (!sig && bare.length >= 3)) && !out.categoryId) {
      const c = CATEGORIES.find((x) => x.name.toLowerCase().startsWith(bare))
      if (c) {
        out.categoryId = c.id
        continue
      }
    }
    if ((sig === 'pm' || (!sig && bare.length >= 3)) && !out.paymentMethodId) {
      const p = PAYMENT_METHODS.find((x) => x.name.toLowerCase().startsWith(bare))
      if (p) {
        out.paymentMethodId = p.id
        continue
      }
    }
    words.push(raw)
  }
  const d = words.join(' ')
  out.description = d ? d[0].toUpperCase() + d.slice(1) : out.categoryId ? categoryName(out.categoryId) : ''
  return out
}

function VariantC({ store }: { store: PrototypeStore }) {
  const f = store.figures
  const [showBudgets, setShowBudgets] = useState(true)
  const commandRef = useRef<HTMLInputElement>(null)
  useMonthKeys(store, { n: () => commandRef.current?.focus(), '/': () => commandRef.current?.focus() })
  const upcoming = store.rules
    .map((r) => ({ r, next: nextDueDate(r) }))
    .filter((x) => x.next && x.next <= addDays(TODAY, 30))
    .sort((a, b) => a.next!.localeCompare(b.next!))

  return (
    <main className="pc">
      <CommandBar store={store} inputRef={commandRef} />

      <section className="pc-hero">
        <div>
          <MonthNav store={store} />
        </div>
        <div className="pc-figures">
          <div>
            <span className="p-small p-muted">Monthly income</span>
            <strong className="p-num">{f.income.length ? formatAmount(f.monthlyIncome) : '—'}</strong>
          </div>
          <span className="pc-op">−</span>
          <div>
            <span className="p-small p-muted">Monthly total</span>
            <strong className="p-num">{formatAmount(f.total)}</strong>
          </div>
          <span className="pc-op">=</span>
          <div>
            <span className="p-small p-muted">Savings</span>
            <strong className="p-num">
              <SavingsFigure figures={f} />
            </strong>
          </div>
        </div>
        <div className="pc-overall">
          <BudgetMeter label="Overall budget" total={f.total} budget={f.overallBudget} state={f.overallState} />
        </div>
      </section>

      <section className="pc-charts">
        <div className="pc-charts-head">
          <h2>Charts</h2>
          <BudgetToggle on={showBudgets} set={setShowBudgets} />
          <ChartLegend
            items={[
              { label: 'Spent / on track' },
              { label: 'Income', color: 'var(--p-income)' },
              ...(showBudgets ? [{ label: 'Close to budget', color: 'var(--p-warn)' }, { label: 'Over budget', color: 'var(--danger)' }, { label: 'Budget', dashed: true }] : []),
            ]}
          />
        </div>
        <figure className="pc-wide">
          <figcaption>Last 12 months (click a bar to open that month)</figcaption>
          <TwelveMonthChart trend={f.trend} showBudgets={showBudgets} showIncome selected={store.month} onSelect={store.setMonth} width={1100} height={190} />
        </figure>
        <figure>
          <figcaption>By category, {formatMonthLabel(store.month)}</figcaption>
          <CategoryBarsChart rows={f.categories} showBudgets={showBudgets} width={540} />
        </figure>
        <figure>
          <figcaption>Compared with {formatMonthLabel(shiftMonth(store.month, -1))}</figcaption>
          <MonthVsLastChart rows={f.categories} month={store.month} width={540} />
        </figure>
      </section>

      <section className="pc-lists">
        <div>
          <h2>Expenses ({f.expenses.length})</h2>
          <ul className="pc-list">
            {f.expenses.map((e) => (
              <li key={e.id}>
                <span className="p-date">{formatDay(e.expenseDate)}</span>
                <span>
                  {e.description} <ExpenseMeta expense={e} />
                </span>
                <span className="p-num">{formatAmount(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Income ({f.income.length})</h2>
          {f.income.length === 0 ? (
            <p className="p-muted">No income in {formatMonthLabel(f.month)}. Savings isn’t shown for this month.</p>
          ) : (
            <ul className="pc-list">
              {f.income.map((i) => (
                <li key={i.id}>
                  <span className="p-date">{formatDay(i.incomeDate)}</span>
                  <span>
                    {i.description} <RecurringMark expense={i} />
                  </span>
                  <span className="p-num p-positive">+{formatAmount(i.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="pc-upcoming-h">Coming up (30 days)</h2>
          <ul className="pc-list">
            {upcoming.map(({ r, next }) => (
              <li key={r.id}>
                <span className="p-date">{formatDay(next!)}</span>
                <span>
                  {r.description} {r.kind === 'income' && <span className="p-income-chip">income</span>}
                </span>
                <span className="p-num">{formatAmount(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Recurring</h2>
          <RecurringManager store={store} dense />
        </div>
      </section>
    </main>
  )
}

function CommandBar({ store, inputRef }: { store: PrototypeStore; inputRef: RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const p = parseCommand(text)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (p.amount === null) return setError(p.amountError ?? 'Start with an amount, like 250.')
    if (!p.description) return setError('Add a few words saying what it was for.')
    if (p.kind === 'income') store.addIncome({ amount: p.amount, description: p.description, incomeDate: p.date })
    else {
      if (!p.categoryId) return setError('Add a category word, like food or #food.')
      store.addExpense({ amount: p.amount, description: p.description, expenseDate: p.date, categoryId: p.categoryId, paymentMethodId: p.paymentMethodId })
    }
    setText('')
    setError(null)
  }
  return (
    <form className="pc-command" onSubmit={submit} noValidate>
      <div className="pc-command-row">
        <span className="pc-prompt">₹</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setText(''), (e.target as HTMLElement).blur())}
          placeholder='Add: "250 lunch food upi"   ·   "+8000 freelance"   ·   "1200 shoes shopping y"'
          aria-label="Add an expense or income"
          autoFocus
        />
        <KeyHint>n</KeyHint>
      </div>
      {text.trim() && (
        <div className="pc-preview" aria-live="polite">
          <span className={p.kind === 'income' ? 'pc-chip pc-chip-income' : 'pc-chip'}>{p.kind === 'income' ? 'Income' : 'Expense'}</span>
          <span className={p.amount === null ? 'pc-chip pc-chip-missing' : 'pc-chip'}>{p.amount === null ? 'amount?' : formatAmount(p.amount)}</span>
          <span className={p.description ? 'pc-chip' : 'pc-chip pc-chip-missing'}>{p.description || 'description?'}</span>
          {p.kind === 'expense' && <span className={p.categoryId ? 'pc-chip' : 'pc-chip pc-chip-missing'}>{p.categoryId ? categoryName(p.categoryId) : 'category?'}</span>}
          {p.kind === 'expense' && <span className="pc-chip pc-chip-soft">{paymentMethodName(p.paymentMethodId) ?? 'no payment method'}</span>}
          <span className="pc-chip pc-chip-soft">{p.date === TODAY ? 'today' : formatDay(p.date)}</span>
          <span className="p-muted p-small">
            <KeyHint>Enter</KeyHint> to add
          </span>
        </div>
      )}
      {error && <p className="p-error">{error}</p>}
    </form>
  )
}
