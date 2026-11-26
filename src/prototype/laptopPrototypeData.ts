// PROTOTYPE, throwaway. In-memory sample data and rules for the laptop layout prototype
// ("Prototype the laptop wide-screen layout and charts", issue #20). Nothing here is saved.
import { useMemo, useState } from 'react'

export const TODAY = '2026-11-26'
/** When the app was "last opened": recurring due dates after this are announced in the notice. */
const LAST_OPENED = '2026-11-20'

export interface PCategory {
  id: string
  name: string
}
export interface PPaymentMethod {
  id: string
  name: string
}
export interface PExpense {
  id: string
  amount: number
  description: string
  expenseDate: string
  categoryId: string
  paymentMethodId: string | null
  recurringId?: string
}
export interface PIncome {
  id: string
  amount: number
  description: string
  incomeDate: string
  recurringId?: string
}
export type Schedule = 'monthly' | 'weekly' | 'yearly'
export interface PRule {
  id: string
  kind: 'expense' | 'income'
  amount: number
  description: string
  categoryId?: string
  paymentMethodId?: string | null
  schedule: Schedule
  startDate: string
  endDate?: string
}
export interface PBudget {
  /** 'overall' or a category id. */
  target: string
  amount: number
  /** First month it applies, YYYY-MM. */
  fromMonth: string
}

export const CATEGORIES: PCategory[] = [
  'Food',
  'Transport',
  'Rent',
  'Bills',
  'Shopping',
  'Health',
  'Entertainment',
  'Other',
].map((name) => ({ id: name.toLowerCase(), name }))

export const PAYMENT_METHODS: PPaymentMethod[] = ['Cash', 'UPI', 'Card'].map((name) => ({ id: name.toLowerCase(), name }))

const BUDGETS: PBudget[] = [
  { target: 'overall', amount: 45_000_00, fromMonth: '2026-01' },
  { target: 'food', amount: 7_000_00, fromMonth: '2026-01' },
  { target: 'food', amount: 8_000_00, fromMonth: '2026-06' },
  { target: 'transport', amount: 3_000_00, fromMonth: '2026-01' },
  { target: 'shopping', amount: 5_000_00, fromMonth: '2026-01' },
  { target: 'entertainment', amount: 2_000_00, fromMonth: '2026-01' },
]

// ---------- dates ----------

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => {
  const d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toIso(d)
}
export const monthOf = (iso: string) => iso.slice(0, 7)
export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return toIso(d).slice(0, 7)
}
export const formatMonthLabel = (month: string, style: 'long' | 'short' = 'long') =>
  toDate(`${month}-01`).toLocaleDateString('en-IN', { month: style, year: style === 'long' ? 'numeric' : '2-digit', timeZone: 'UTC' })
export const formatDay = (iso: string) =>
  toDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const formatWeekday = (iso: string) => toDate(iso).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })

export function describeSchedule(rule: PRule): string {
  const day = Number(rule.startDate.slice(8))
  if (rule.schedule === 'monthly') return `Monthly on day ${day}${day > 28 ? ' (or month end)' : ''}`
  if (rule.schedule === 'weekly') return `Weekly on ${formatWeekday(rule.startDate)}`
  return `Yearly on ${formatDay(rule.startDate)}`
}

/** Every due date of a rule from its start up to and including `until`. */
export function dueDates(rule: PRule, until: string): string[] {
  const last = rule.endDate && rule.endDate < until ? rule.endDate : until
  const out: string[] = []
  if (rule.schedule === 'weekly') {
    for (let d = rule.startDate; d <= last; d = addDays(d, 7)) out.push(d)
    return out
  }
  const day = Number(rule.startDate.slice(8))
  const step = rule.schedule === 'monthly' ? 1 : 12
  for (let m = monthOf(rule.startDate); `${m}-01` <= last; m = shiftMonth(m, step)) {
    const d = `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`
    if (d >= rule.startDate && d <= last) out.push(d)
  }
  return out
}

export function nextDueDate(rule: PRule): string | null {
  const upcoming = dueDates(rule, addDays(TODAY, 400)).filter((d) => d > TODAY)
  return upcoming[0] ?? null
}

// ---------- sample data ----------

const RULES: PRule[] = [
  { id: 'r-rent', kind: 'expense', amount: 18_000_00, description: 'Rent', categoryId: 'rent', paymentMethodId: 'upi', schedule: 'monthly', startDate: '2025-12-05' },
  { id: 'r-netflix', kind: 'expense', amount: 649_00, description: 'Netflix', categoryId: 'entertainment', paymentMethodId: 'card', schedule: 'monthly', startDate: '2025-12-12' },
  { id: 'r-phone', kind: 'expense', amount: 399_00, description: 'Phone bill', categoryId: 'bills', paymentMethodId: 'upi', schedule: 'monthly', startDate: '2025-12-25' },
  { id: 'r-gym', kind: 'expense', amount: 1_500_00, description: 'Gym membership', categoryId: 'health', paymentMethodId: 'card', schedule: 'monthly', startDate: '2026-09-01' },
  { id: 'r-paper', kind: 'expense', amount: 120_00, description: 'Newspaper', categoryId: 'bills', paymentMethodId: 'cash', schedule: 'weekly', startDate: '2026-10-03' },
  { id: 'r-insurance', kind: 'expense', amount: 12_400_00, description: 'Health insurance', categoryId: 'health', paymentMethodId: 'card', schedule: 'yearly', startDate: '2026-03-15' },
  { id: 'r-spotify', kind: 'expense', amount: 119_00, description: 'Spotify', categoryId: 'entertainment', paymentMethodId: 'card', schedule: 'monthly', startDate: '2025-12-08', endDate: '2026-05-08' },
  { id: 'r-salary', kind: 'income', amount: 60_000_00, description: 'Salary', schedule: 'monthly', startDate: '2026-01-01' },
]

/** Rupees of non-recurring spending per category for Dec 2025 … Nov 2026. */
const MANUAL_TARGETS: Record<string, number[]> = {
  food: [7200, 6800, 7500, 7000, 7900, 6500, 7100, 7400, 8600, 7300, 6900, 6900],
  transport: [2400, 2100, 2600, 2300, 2500, 2200, 2800, 2600, 2400, 2900, 2500, 2100],
  bills: [1800, 2100, 1900, 1500, 1400, 2400, 2900, 3100, 2600, 2000, 1700, 1600],
  shopping: [4200, 1500, 2000, 3500, 2800, 1900, 2600, 3100, 2400, 6500, 3200, 2700],
  health: [600, 1200, 0, 900, 400, 0, 1500, 300, 700, 500, 800, 400],
  entertainment: [1800, 900, 1200, 1100, 1500, 1300, 1700, 1400, 1600, 1000, 1200, 1900],
  other: [500, 0, 800, 0, 1200, 0, 600, 0, 900, 24000, 400, 300],
}
const DESCRIPTIONS: Record<string, string[]> = {
  food: ['Groceries', 'Lunch', 'Swiggy dinner', 'Vegetables', 'Coffee', 'Milk & bread'],
  transport: ['Metro card', 'Auto', 'Uber', 'Petrol'],
  bills: ['Electricity', 'Water bill', 'Internet'],
  shopping: ['Shirt', 'Shoes', 'Amazon order', 'Kitchen things'],
  health: ['Medicines', 'Doctor visit'],
  entertainment: ['Movie', 'Concert', 'Books'],
  other: ['Gift', 'Haircut', 'Courier'],
}

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function buildInitial() {
  const rand = seeded(42)
  const firstMonth = '2025-12'
  const expenses: PExpense[] = []
  const income: PIncome[] = []
  for (let i = 0; i < 12; i++) {
    const month = shiftMonth(firstMonth, i)
    const lastDay = month === monthOf(TODAY) ? Number(TODAY.slice(8)) : daysInMonth(month)
    for (const [cat, targets] of Object.entries(MANUAL_TARGETS)) {
      let remaining = targets[i] * 100
      if (remaining === 0) continue
      // A big one-off "Laptop repair" in Sep 2026 makes savings negative that month.
      if (cat === 'other' && targets[i] >= 10000) {
        expenses.push({ id: `m-${month}-repair`, amount: remaining, description: 'Laptop repair', expenseDate: `${month}-18`, categoryId: 'other', paymentMethodId: 'card' })
        continue
      }
      const pieces = Math.max(1, Math.round(targets[i] / 900))
      for (let p = 0; p < pieces; p++) {
        const amount = p === pieces - 1 ? remaining : Math.round((remaining / (pieces - p)) * (0.6 + rand() * 0.8) / 100) * 100
        remaining -= amount
        const day = String(1 + Math.floor(rand() * lastDay)).padStart(2, '0')
        const descs = DESCRIPTIONS[cat]
        const pm = rand() < 0.15 ? null : PAYMENT_METHODS[Math.floor(rand() * 3)].id
        expenses.push({ id: `m-${month}-${cat}-${p}`, amount, description: descs[Math.floor(rand() * descs.length)], expenseDate: `${month}-${day}`, categoryId: cat, paymentMethodId: pm })
      }
    }
  }
  income.push(
    { id: 'i-free-1', amount: 8_000_00, description: 'Freelance logo', incomeDate: '2026-03-20' },
    { id: 'i-free-2', amount: 12_000_00, description: 'Freelance website', incomeDate: '2026-07-14' },
    { id: 'i-gift', amount: 2_000_00, description: 'Diwali gift', incomeDate: '2026-11-08' },
  )
  const justRecorded: string[] = []
  for (const rule of RULES) {
    for (const d of dueDates(rule, TODAY)) {
      const id = `${rule.id}:${d}`
      if (rule.kind === 'expense') {
        expenses.push({ id, amount: rule.amount, description: rule.description, expenseDate: d, categoryId: rule.categoryId!, paymentMethodId: rule.paymentMethodId ?? null, recurringId: rule.id })
      } else {
        income.push({ id, amount: rule.amount, description: rule.description, incomeDate: d, recurringId: rule.id })
      }
      if (d > LAST_OPENED) justRecorded.push(`${rule.description} (${formatDay(d)})`)
    }
  }
  const notice = justRecorded.length
    ? `Recorded ${justRecorded.length} recurring ${justRecorded.length === 1 ? 'expense' : 'expenses'}: ${justRecorded.join(', ')}.`
    : null
  return { expenses, income, rules: RULES, notice }
}

// ---------- derived figures ----------

export type BudgetState = 'ok' | 'close' | 'over'

export function budgetFor(target: string, month: string): number | null {
  const applying = BUDGETS.filter((b) => b.target === target && b.fromMonth <= month).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))
  return applying.at(-1)?.amount ?? null
}

export function budgetState(total: number, budget: number | null): BudgetState | null {
  if (budget === null) return null
  if (total > budget) return 'over'
  if (total * 100 >= budget * 80) return 'close'
  return 'ok'
}

export interface CategoryRow {
  id: string
  name: string
  total: number
  lastMonth: number
  budget: number | null
  state: BudgetState | null
}

export interface MonthFigures {
  month: string
  expenses: PExpense[]
  income: PIncome[]
  total: number
  monthlyIncome: number
  /** null when the month has no income. */
  savings: number | null
  overallBudget: number | null
  overallState: BudgetState | null
  categories: CategoryRow[]
  trend: { month: string; spent: number; income: number; budget: number | null }[]
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0)

function figuresFor(month: string, expenses: PExpense[], income: PIncome[]): MonthFigures {
  const inMonth = (m: string) => expenses.filter((e) => monthOf(e.expenseDate) === m)
  const incomeIn = (m: string) => income.filter((i) => monthOf(i.incomeDate) === m)
  const mine = inMonth(month).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || a.id.localeCompare(b.id))
  const prev = inMonth(shiftMonth(month, -1))
  const myIncome = incomeIn(month).sort((a, b) => b.incomeDate.localeCompare(a.incomeDate))
  const total = sum(mine)
  const monthlyIncome = sum(myIncome)
  const overallBudget = budgetFor('overall', month)
  const categories = CATEGORIES.map((c) => {
    const t = sum(mine.filter((e) => e.categoryId === c.id))
    const budget = budgetFor(c.id, month)
    return { id: c.id, name: c.name, total: t, lastMonth: sum(prev.filter((e) => e.categoryId === c.id)), budget, state: budgetState(t, budget) }
  }).filter((r) => r.total > 0 || r.lastMonth > 0 || r.budget !== null)
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(month, i - 11)
    return { month: m, spent: sum(inMonth(m)), income: sum(incomeIn(m)), budget: budgetFor('overall', m) }
  })
  return {
    month,
    expenses: mine,
    income: myIncome,
    total,
    monthlyIncome,
    savings: myIncome.length ? monthlyIncome - total : null,
    overallBudget,
    overallState: budgetState(total, overallBudget),
    categories,
    trend,
  }
}

// ---------- the store ----------

export interface NewExpense {
  amount: number
  description: string
  expenseDate: string
  categoryId: string
  paymentMethodId: string | null
}
export interface NewIncome {
  amount: number
  description: string
  incomeDate: string
}

let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`

export function usePrototypeStore() {
  const [initial] = useState(buildInitial)
  const [expenses, setExpenses] = useState(initial.expenses)
  const [income, setIncome] = useState(initial.income)
  const [rules, setRules] = useState(initial.rules)
  const [notice, setNotice] = useState<string | null>(initial.notice)
  const [toast, setToast] = useState<string | null>(null)
  const [month, setMonth] = useState(() => new URLSearchParams(location.search).get('month') ?? monthOf(TODAY))
  const figures = useMemo(() => figuresFor(month, expenses, income), [month, expenses, income])

  function showToast(text: string) {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 6000)
  }

  /** Adds an expense, and reports a message when the save pushes a total past a level (ADR-0004 rules). */
  function addExpense(input: NewExpense) {
    const m = monthOf(input.expenseDate)
    const before = figuresFor(m, expenses, income)
    const next = [...expenses, { id: newId('e'), ...input }]
    setExpenses(next)
    const after = figuresFor(m, next, income)
    const rank = { ok: 0, close: 1, over: 2 } as const
    const inMonth = m === monthOf(TODAY) ? '' : ` in ${formatMonthLabel(m)}`
    const messages: string[] = []
    const cat = after.categories.find((c) => c.id === input.categoryId)
    const catBefore = before.categories.find((c) => c.id === input.categoryId)
    if (cat?.state && rank[cat.state] > rank[catBefore?.state ?? 'ok']) {
      messages.push(`${cat.name} is ${cat.state === 'over' ? 'over budget' : 'close to budget'}${inMonth}: ${pct(cat.total, cat.budget!)} of its budget.`)
    }
    if (after.overallState && rank[after.overallState] > rank[before.overallState ?? 'ok']) {
      messages.push(`The monthly total is ${after.overallState === 'over' ? 'over budget' : 'close to budget'}${inMonth}.`)
    }
    if (messages.length) showToast(messages.join(' '))
    if (m !== month) setMonth(m)
  }

  function addIncome(input: NewIncome) {
    setIncome((xs) => [...xs, { id: newId('i'), ...input }])
    const m = monthOf(input.incomeDate)
    if (m !== month) setMonth(m)
  }

  function saveRule(rule: PRule) {
    setRules((rs) => (rs.some((r) => r.id === rule.id) ? rs.map((r) => (r.id === rule.id ? rule : r)) : [...rs, rule]))
    // A new rule starting today or earlier records its due dates now, like opening the app would.
    if (!rules.some((r) => r.id === rule.id)) {
      const due = dueDates(rule, TODAY)
      if (rule.kind === 'expense') {
        setExpenses((xs) => [...xs, ...due.map((d) => ({ id: `${rule.id}:${d}`, amount: rule.amount, description: rule.description, expenseDate: d, categoryId: rule.categoryId!, paymentMethodId: rule.paymentMethodId ?? null, recurringId: rule.id }))])
      } else {
        setIncome((xs) => [...xs, ...due.map((d) => ({ id: `${rule.id}:${d}`, amount: rule.amount, description: rule.description, incomeDate: d, recurringId: rule.id }))])
      }
      if (due.length) setNotice(`Recorded ${due.length} ${rule.kind === 'expense' ? 'recurring expenses' : 'recurring income'} for ${rule.description}.`)
    }
  }

  /** Stop only affects due dates not yet recorded. */
  function stopRule(id: string) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, endDate: TODAY } : r)))
  }

  return {
    month,
    setMonth,
    figures,
    rules,
    notice,
    dismissNotice: () => setNotice(null),
    toast,
    dismissToast: () => setToast(null),
    addExpense,
    addIncome,
    saveRule,
    stopRule,
    newRuleId: () => newId('r'),
  }
}

export type PrototypeStore = ReturnType<typeof usePrototypeStore>

export const pct = (part: number, whole: number) => `${Math.round((part * 100) / whole)}%`
export const categoryName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name ?? id
export const paymentMethodName = (id: string | null | undefined) => (id ? PAYMENT_METHODS.find((p) => p.id === id)?.name ?? id : null)
