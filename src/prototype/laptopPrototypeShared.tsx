// PROTOTYPE, throwaway. Pieces shared by the laptop layout variants: the three plain-SVG charts,
// the budget meter, recurring management, notices and the variant switcher.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { formatAmount, parseAmount, toAmountText } from '../domain/money.ts'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  TODAY,
  categoryName,
  describeSchedule,
  formatDay,
  formatMonthLabel,
  nextDueDate,
  paymentMethodName,
  pct,
  type BudgetState,
  type CategoryRow,
  type MonthFigures,
  type PExpense,
  type PRule,
  type PrototypeStore,
  type Schedule,
} from './laptopPrototypeData.ts'

const compact = (minor: number) => {
  const rupees = minor / 100
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`
  if (rupees >= 1000) return `₹${Math.round(rupees / 1000)}k`
  return `₹${Math.round(rupees)}`
}

const stateFill = (state: BudgetState | null, showBudgets: boolean) =>
  !showBudgets || !state || state === 'ok' ? 'var(--accent)' : state === 'close' ? 'var(--p-warn)' : 'var(--danger)'

// ---------- charts ----------

/** Chart 1: this month's category totals, optionally with each category budget as a marker. */
export function CategoryBarsChart({ rows, showBudgets, width = 480 }: { rows: CategoryRow[]; showBudgets: boolean; width?: number }) {
  const shown = rows.filter((r) => r.total > 0 || (showBudgets && r.budget !== null)).sort((a, b) => b.total - a.total)
  const labelW = 104
  const valueW = 84
  const rowH = 26
  const barW = width - labelW - valueW
  const max = Math.max(1, ...shown.map((r) => Math.max(r.total, showBudgets ? r.budget ?? 0 : 0)))
  const x = (v: number) => (v / max) * barW
  return (
    <svg viewBox={`0 0 ${width} ${shown.length * rowH + 4}`} className="p-chart" role="img">
      <title>Spending by category this month{showBudgets ? ', with budgets' : ''}</title>
      {shown.map((r, i) => {
        const y = i * rowH + 4
        return (
          <g key={r.id}>
            <text x={0} y={y + 13} className="p-chart-label">
              {r.name}
            </text>
            <rect x={labelW} y={y + 2} width={Math.max(2, x(r.total))} height={rowH - 10} rx={3} fill={stateFill(r.state, showBudgets)}>
              <title>{`${r.name}: ${formatAmount(r.total)}${r.budget ? ` of ${formatAmount(r.budget)}` : ''}`}</title>
            </rect>
            {showBudgets && r.budget !== null && (
              <line x1={labelW + x(r.budget)} x2={labelW + x(r.budget)} y1={y - 1} y2={y + rowH - 5} className="p-chart-budget" />
            )}
            <text x={width} y={y + 13} textAnchor="end" className="p-chart-value">
              {compact(r.total)}
              {showBudgets && r.budget !== null ? ` / ${compact(r.budget)}` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Chart 2: 12-month totals, optionally with income bars and the overall budget line. */
export function TwelveMonthChart({
  trend,
  showBudgets,
  showIncome,
  selected,
  onSelect,
  width = 640,
  height = 200,
}: {
  trend: MonthFigures['trend']
  showBudgets: boolean
  showIncome: boolean
  selected: string
  onSelect?: (month: string) => void
  width?: number
  height?: number
}) {
  const left = 40
  const bottom = 20
  const plotH = height - bottom - 6
  const max = Math.max(1, ...trend.map((t) => Math.max(t.spent, showIncome ? t.income : 0, showBudgets ? t.budget ?? 0 : 0)))
  const y = (v: number) => 6 + plotH - (v / max) * plotH
  const slot = (width - left) / trend.length
  const barW = showIncome ? slot * 0.34 : slot * 0.6
  const ticks = [0, max / 2, max]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="p-chart" role="img">
      <title>Monthly totals for the last 12 months{showIncome ? ' with income' : ''}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={width} y1={y(t)} y2={y(t)} className="p-chart-grid" />
          <text x={left - 4} y={y(t) + 4} textAnchor="end" className="p-chart-tick">
            {compact(t)}
          </text>
        </g>
      ))}
      {trend.map((t, i) => {
        const x0 = left + i * slot
        const isSel = t.month === selected
        const spentX = showIncome ? x0 + slot * 0.14 : x0 + slot * 0.2
        return (
          <g key={t.month} onClick={() => onSelect?.(t.month)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
            {isSel && <rect x={x0 + 1} y={0} width={slot - 2} height={height - bottom + 2} className="p-chart-selected" />}
            <rect x={spentX} y={y(t.spent)} width={barW} height={Math.max(0, plotH + 6 - y(t.spent))} rx={2} fill={showBudgets ? stateFill(budgetStateOf(t), true) : 'var(--accent)'}>
              <title>{`${formatMonthLabel(t.month)}: spent ${formatAmount(t.spent)}${t.budget ? ` of ${formatAmount(t.budget)}` : ''}`}</title>
            </rect>
            {showIncome && t.income > 0 && (
              <rect x={spentX + barW + 2} y={y(t.income)} width={barW} height={plotH + 6 - y(t.income)} rx={2} fill="var(--p-income)">
                <title>{`${formatMonthLabel(t.month)}: income ${formatAmount(t.income)}`}</title>
              </rect>
            )}
            {showBudgets && t.budget !== null && <line x1={x0 + 2} x2={x0 + slot - 2} y1={y(t.budget)} y2={y(t.budget)} className="p-chart-budget" />}
            <text x={x0 + slot / 2} y={height - 4} textAnchor="middle" className={isSel ? 'p-chart-tick p-chart-tick-sel' : 'p-chart-tick'}>
              {formatMonthLabel(t.month, 'short').split(' ')[0]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function budgetStateOf(t: { spent: number; budget: number | null }): BudgetState | null {
  if (t.budget === null) return null
  return t.spent > t.budget ? 'over' : t.spent * 100 >= t.budget * 80 ? 'close' : 'ok'
}

/** Chart 3: this month vs last month, per category. */
export function MonthVsLastChart({ rows, month, width = 480 }: { rows: CategoryRow[]; month: string; width?: number }) {
  const shown = rows.filter((r) => r.total > 0 || r.lastMonth > 0).sort((a, b) => b.total - a.total)
  const labelW = 104
  const valueW = 70
  const rowH = 30
  const barW = width - labelW - valueW
  const max = Math.max(1, ...shown.flatMap((r) => [r.total, r.lastMonth]))
  const x = (v: number) => (v / max) * barW
  return (
    <svg viewBox={`0 0 ${width} ${shown.length * rowH + 4}`} className="p-chart" role="img">
      <title>{`${formatMonthLabel(month)} compared with the month before, per category`}</title>
      {shown.map((r, i) => {
        const y0 = i * rowH + 4
        const diff = r.total - r.lastMonth
        return (
          <g key={r.id}>
            <text x={0} y={y0 + 15} className="p-chart-label">
              {r.name}
            </text>
            <rect x={labelW} y={y0 + 2} width={Math.max(1, x(r.total))} height={10} rx={2} fill="var(--accent)" />
            <rect x={labelW} y={y0 + 14} width={Math.max(1, x(r.lastMonth))} height={8} rx={2} fill="var(--p-muted-bar)" />
            <text x={width} y={y0 + 15} textAnchor="end" className={diff > 0 ? 'p-chart-value p-up' : 'p-chart-value p-down'}>
              {diff === 0 ? '±0' : `${diff > 0 ? '+' : '−'}${compact(Math.abs(diff))}`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function ChartLegend({ items }: { items: { label: string; color?: string; dashed?: boolean }[] }) {
  return (
    <ul className="p-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={i.dashed ? 'p-legend-dash' : 'p-legend-swatch'} style={i.color ? { background: i.color } : undefined} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

// ---------- budget meter ----------

const STATE_WORD: Record<BudgetState, string> = { ok: '● On track', close: '▲ Close to budget', over: '✕ Over budget' }

export function BudgetMeter({ label, total, budget, state, size = 'normal' }: { label: string; total: number; budget: number | null; state: BudgetState | null; size?: 'normal' | 'small' }) {
  if (budget === null || state === null) {
    return (
      <div className={`p-meter p-meter-${size}`}>
        <div className="p-meter-head">
          <span>{label}</span>
          <span className="p-num">{formatAmount(total)}</span>
        </div>
        <p className="p-muted p-small">No budget</p>
      </div>
    )
  }
  const left = budget - total
  return (
    <div className={`p-meter p-meter-${size} p-state-${state}`}>
      <div className="p-meter-head">
        <span>{label}</span>
        <span className="p-state-word">{STATE_WORD[state]}</span>
      </div>
      <div className="p-meter-track">
        <div className="p-meter-fill" style={{ width: `${Math.min(100, (total * 100) / budget)}%` }} />
        <div className="p-meter-80" title="80%: close to budget" />
      </div>
      <p className="p-small p-num">
        {formatAmount(total)} of {formatAmount(budget)} · {pct(total, budget)} ·{' '}
        {left >= 0 ? `${formatAmount(left)} left` : <strong>{formatAmount(-left)} over</strong>}
      </p>
    </div>
  )
}

export function StateDot({ state }: { state: BudgetState | null }) {
  if (!state || state === 'ok') return null
  return <span className={`p-state-chip p-state-${state}`}>{state === 'over' ? '✕ over' : '▲ close'}</span>
}

// ---------- summary ----------

export function SavingsFigure({ figures }: { figures: MonthFigures }) {
  if (figures.savings === null) return <span className="p-muted">No income this month</span>
  const negative = figures.savings < 0
  return (
    <span className={negative ? 'p-negative' : 'p-positive'}>
      {negative ? '−' : ''}
      {formatAmount(Math.abs(figures.savings))}
      {negative && <span className="p-warn-note"> ⚠ spent more than came in</span>}
    </span>
  )
}

// ---------- expense row bits ----------

export function RecurringMark({ expense }: { expense: { recurringId?: string } }) {
  return expense.recurringId ? (
    <span className="p-recurring-mark" title="Recorded by a recurring expense">
      ↻ recurring
    </span>
  ) : null
}

export function ExpenseMeta({ expense }: { expense: PExpense }) {
  const pm = paymentMethodName(expense.paymentMethodId)
  return (
    <span className="p-meta">
      {categoryName(expense.categoryId)}
      {pm && ` · ${pm}`}
      <RecurringMark expense={expense} />
    </span>
  )
}

// ---------- notices ----------

export function NoticeBar({ store }: { store: PrototypeStore }) {
  return (
    <>
      {store.notice && (
        <div className="p-notice" role="status">
          <span>↻ {store.notice}</span>
          <button type="button" onClick={store.dismissNotice} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {store.toast && (
        <div className="p-toast" role="alert">
          <span>{store.toast}</span>
          <button type="button" onClick={store.dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </>
  )
}

// ---------- recurring management ----------

export function RecurringManager({ store, kind, dense = false }: { store: PrototypeStore; kind?: 'expense' | 'income'; dense?: boolean }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const rules = store.rules.filter((r) => !kind || r.kind === kind)
  const active = rules.filter((r) => nextDueDate(r) !== null).sort((a, b) => nextDueDate(a)!.localeCompare(nextDueDate(b)!))
  const ended = rules.filter((r) => nextDueDate(r) === null)
  return (
    <div className={dense ? 'p-recurring p-dense' : 'p-recurring'}>
      <ul className="p-rule-list">
        {[...active, ...ended].map((r) =>
          editing === r.id ? (
            <li key={r.id}>
              <RuleForm store={store} rule={r} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id} className={nextDueDate(r) ? '' : 'p-rule-ended'}>
              <div className="p-rule-main">
                <span className="p-rule-desc">
                  {r.description}
                  {r.kind === 'income' && <span className="p-income-chip">income</span>}
                </span>
                <span className="p-meta">
                  {describeSchedule(r)}
                  {r.kind === 'expense' && ` · ${categoryName(r.categoryId!)}`}
                </span>
              </div>
              <span className="p-num">{formatAmount(r.amount)}</span>
              <span className="p-rule-next">
                {nextDueDate(r) ? (
                  <>
                    Next <strong>{formatDay(nextDueDate(r)!)}</strong>
                  </>
                ) : (
                  <span className="p-muted">Ended {formatDay(r.endDate!)}</span>
                )}
              </span>
              <span className="p-row-actions">
                <button type="button" onClick={() => setEditing(r.id)}>
                  Edit
                </button>
                {nextDueDate(r) && (
                  <button
                    type="button"
                    className="p-danger"
                    onClick={() => {
                      if (window.confirm(`Stop "${r.description}"? Nothing more will be recorded from today. Expenses already recorded stay.`)) store.stopRule(r.id)
                    }}
                  >
                    Stop
                  </button>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <RuleForm store={store} defaultKind={kind ?? 'expense'} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="p-btn-secondary" onClick={() => setEditing('new')}>
          + Add recurring {kind ?? 'expense or income'}
        </button>
      )}
    </div>
  )
}

function RuleForm({ store, rule, defaultKind = 'expense', onDone }: { store: PrototypeStore; rule?: PRule; defaultKind?: 'expense' | 'income'; onDone: () => void }) {
  const [kind, setKind] = useState(rule?.kind ?? defaultKind)
  const [amount, setAmount] = useState(rule ? toAmountText(rule.amount) : '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? 'bills')
  const [paymentMethodId, setPaymentMethodId] = useState(rule?.paymentMethodId ?? '')
  const [schedule, setSchedule] = useState<Schedule>(rule?.schedule ?? 'monthly')
  const [startDate, setStartDate] = useState(rule?.startDate ?? TODAY)
  const [endDate, setEndDate] = useState(rule?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed.ok) return setError(parsed.message)
    if (!description.trim()) return setError('Add a description.')
    store.saveRule({
      id: rule?.id ?? store.newRuleId(),
      kind,
      amount: parsed.minorUnits,
      description: description.trim(),
      categoryId: kind === 'expense' ? categoryId : undefined,
      paymentMethodId: kind === 'expense' ? paymentMethodId || null : undefined,
      schedule,
      startDate,
      endDate: endDate || undefined,
    })
    onDone()
  }

  return (
    <form className="p-rule-form" onSubmit={submit} noValidate>
      {rule && <p className="p-small p-muted p-span">Changes only affect due dates not yet recorded.</p>}
      {!rule && (
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
      )}
      <label>
        Amount (₹)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {kind === 'expense' && (
        <>
          <label>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
              <option value="">None</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {!rule && (
        <>
          <label>
            Repeats
            <select value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>
            Starts
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </>
      )}
      <label>
        Ends (optional)
        <input type="date" value={endDate} min={TODAY} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      {error && <p className="p-error p-span">{error}</p>}
      <div className="p-form-actions p-span">
        <button type="submit" className="p-btn">
          {rule ? 'Save' : 'Add'}
        </button>
        <button type="button" className="p-btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------- keyboard ----------

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/** Single-key shortcuts that are ignored while typing in a field. */
export function useShortcuts(map: Record<string, () => void>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const fn = map[e.key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

export function KeyHint({ children }: { children: ReactNode }) {
  return <kbd className="p-kbd">{children}</kbd>
}

/** Picks a category or payment method by typed prefix, e.g. "fo" → Food, "u" → UPI. */
export function matchByPrefix<T extends { id: string; name: string }>(list: T[], text: string): T | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  return list.find((x) => x.name.toLowerCase().startsWith(t))
}

// ---------- variant switcher ----------

export function PrototypeSwitcher({ variants, current, onChange }: { variants: { key: string; name: string }[]; current: string; onChange: (key: string) => void }) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current))
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="p-switcher" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        PROTOTYPE {variants[i].key} ({variants[i].name})
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  )
}
