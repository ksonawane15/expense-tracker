# Amounts stored as integer minor units

Amounts are stored, summed and exported as whole numbers of minor units (paise), never as decimal floats. Adding up floats builds rounding errors into monthly totals and category totals (`0.1 + 0.2 !== 0.3`). Decimals appear only at the edges: parsing what the user types (up to 2 decimal places, positive, at most ₹1,00,00,000) and formatting for display with `Intl.NumberFormat` (`en-IN`, INR). Export files use the same integers, so changing this later would need a schema migration.
