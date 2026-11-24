const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

/** Formats minor units for display, e.g. 10000000 → "₹1,00,000.00" (ADR-0002). */
export function formatAmount(minorUnits: number): string {
  return inrFormat.format(minorUnits / 100)
}

/**
 * Minor units as the plain text a user would type, for pre-filling an edit:
 * 25075 → "250.75", 25000 → "250". Integer maths only; parseAmount reverses it.
 */
export function toAmountText(minorUnits: number): string {
  const wholeRupees = Math.trunc(minorUnits / 100)
  const paise = minorUnits % 100
  return paise === 0 ? String(wholeRupees) : `${wholeRupees}.${String(paise).padStart(2, '0')}`
}

/** ₹1,00,00,000 in minor units: the largest amount a single expense may have. */
const MAX_AMOUNT = 1_000_000_000

/** An optional minus sign, whole rupees, then any number of decimal digits. */
const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/

/**
 * Converts typed rupees to integer minor units by string parsing, never float
 * maths (ADR-0002). Rejects anything that isn't a positive amount with at most
 * 2 decimal places and at most ₹1,00,00,000, saying what was wrong.
 */
export function parseAmount(text: string): { ok: true; minorUnits: number } | { ok: false; message: string } {
  const match = NUMBER_PATTERN.exec(text.trim())
  if (!match) {
    return { ok: false, message: 'Enter an amount in rupees, like 250 or 12.50.' }
  }
  const [, sign, wholeRupees, paise = ''] = match
  if (paise.length > 2) {
    return { ok: false, message: 'Amount can have at most 2 decimal places.' }
  }
  const minorUnits = Number(wholeRupees) * 100 + Number(paise.padEnd(2, '0'))
  if (sign === '-' || minorUnits === 0) {
    return { ok: false, message: 'Amount must be more than zero.' }
  }
  if (minorUnits > MAX_AMOUNT) {
    return { ok: false, message: 'Amount can be at most ₹1,00,00,000.' }
  }
  return { ok: true, minorUnits }
}
