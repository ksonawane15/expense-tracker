# Which chart library fits a small, offline, no-server React app?

Research for issue #14 (wayfinder map #12). Checked on 2026-11-25 against npm, GitHub and each library's own docs. This branch is throwaway and is never merged.

## Question

v2 needs three charts, readable on phone and laptop in light and dark themes:

1. A month's category totals as a bar chart.
2. Monthly totals over the last 12 months.
3. This month vs last month per category (grouped bars).

Amounts are integer minor units (paise), displayed with `formatAmount()` in `src/domain/money.ts` (`Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`, ADR-0002). The app today depends only on `react`/`react-dom` 19.3, built with Vite 8 and TypeScript 7.

## Answer

**Hand-roll the three charts as plain SVG React components.** They add about 2–4 kB gzipped, need no dependency, take theme colours straight from the CSS variables, and call `formatAmount()` directly. We also decide exactly how screen readers get the numbers. All three charts are simple bars or a single line over at most 12 categories or 12 months. That needs a band layout, a linear scale and a "nice ticks" helper, roughly 150–250 lines in total, and all of it is pure functions that can be tested in Vitest.

**Fallback: Recharts 3.** Switch to it if v2 grows into charts that need real interaction (brushing, zoom, rich tooltips). It is the best maintained React option, accessible by default, and SVG-based, so CSS variables work. Load it with `React.lazy` on the charts screen, because it adds about 138 kB gzipped, which is double the current app.

## Candidates compared

| | Hand-rolled SVG | Recharts 3.11.1 | Chart.js 4.6.2 + react-chartjs-2 5.3.1 | visx 4.0.0 | Nivo 0.99.0 |
|---|---|---|---|---|---|
| Rendering | SVG | SVG | Canvas | SVG primitives | SVG (or canvas) |
| Added size, gzipped, for our 3 charts (measured, see below) | ~2–4 kB | **+138 kB** | **+62 kB** | **+25 kB** | +~90 kB (full package, bundlephobia) |
| Offline / no CDN | Yes | Yes, npm bundle | Yes, npm bundle | Yes, npm bundle | Yes, npm bundle |
| Accessibility | Up to us (`role="img"`, `<title>`, data table) | `accessibilityLayer` on by default (keyboard + screen reader) | Canvas is invisible to screen readers; we must add `aria-label` and fallback content | Up to us | Some ARIA props; partly up to us |
| Responsive | `viewBox` + CSS | `responsive` prop or `ResponsiveContainer` | `responsive: true`, but needs a dedicated, relatively positioned container | Up to us (or `@visx/responsive`) | `Responsive*` wrappers |
| Light/dark theme | CSS variables directly | CSS variables work in SVG `fill`/`stroke` | Canvas can't read CSS variables; we must re-read computed styles and update the chart when the theme changes | CSS variables directly | Theme object in JS |
| Custom formatter (en-IN) | Call `formatAmount()` | `tickFormatter` on axes, `formatter` on `Tooltip` | `ticks.callback`, tooltip `callbacks.label` | `tickFormat` on `Axis*` | `format` / `valueFormat` props |
| TypeScript | Ours | Bundled types | Bundled types (both packages) | Bundled types | Bundled types |
| Last release | n/a | 2026-11-23 | chart.js 2026-11-23; wrapper 2025-10-27 | 2026-06-11 | 2025-05-23 |
| Repo activity (pushed / open issues) | n/a | 2026-11-25 / 479 | 2026-11-25 / 556 | 2026-06-22 / 170 | 2026-07-21 / 75 |

Apache ECharts 6.1.0 was dropped early. bundlephobia puts the full package at 368 kB gzipped, far too much for three bar charts.

## Findings by candidate

### Hand-rolled SVG

- No dependency, nothing to keep up to date, nothing new to precache in the PWA.
- Theming: `fill="var(--chart-1)"` works the same way it does for any other element, so the existing light/dark CSS covers charts too.
- Formatting: axis labels and value labels call `formatAmount()` (or a short-form variant such as "₹12.5K", if axes need one) with no adapter. Values stay in paise until display, as ADR-0002 requires.
- Accessibility: we own it. Plan: `<svg role="img" aria-labelledby>` with a `<title>`/`<desc>`, plus a visually hidden (or toggleable) `<table>` of the same numbers. The table also gives a fallback that works well on a phone. Value labels on the bars avoid needing hover tooltips, which work poorly on touch.
- Cost: we write band/linear scale maths, nice ticks and label truncation for long category names. These are small, pure and testable.

### Recharts 3.11.1

- Released 2026-11-23, repo pushed 2026-11-25, 27.8k stars, MIT, bundled types (`types/index.d.ts`). Peer deps accept React 19. (npm `recharts`; GitHub `recharts/recharts`)
- `BarChart` has `accessibilityLayer`, default `true`, which "turns on accessibility support for keyboard-only and screen reader users". It also has a `responsive` prop, "similar to ResponsiveContainer but without the need for an extra wrapper component". (https://recharts.github.io/en-US/api/BarChart/)
- `XAxis`/`YAxis` take `tickFormatter` (https://recharts.github.io/en-US/api/YAxis/). `Tooltip` takes `formatter`.
- Cost: its dependencies include `@reduxjs/toolkit`, `react-redux`, `immer`, `reselect`, `es-toolkit`, `decimal.js-light` and `victory-vendor` (d3). bundlephobia: 177 kB gzipped for the full package. Measured for our charts: +138 kB gzipped.

### Chart.js 4.6.2 + react-chartjs-2 5.3.1

- Chart.js released 2026-11-23, 67.8k stars, very active. react-chartjs-2's last release was 2025-10-27, but its repo was pushed 2026-11-20. MIT, bundled types.
- It can be tree-shaken: "it is necessary to import and register the controllers, elements, scales..." that you use (https://www.chartjs.org/docs/latest/getting-started/integration.html). Our measurement registers only bar, line, category, linear, tooltip and legend.
- Accessibility: "the `canvas` content will not be accessible to screen readers". It "has to be added with ARIA attributes on the `canvas` element" or fallback content (https://www.chartjs.org/docs/latest/general/accessibility.html). So we would write the same data table as with hand-rolled SVG anyway.
- Responsive mode "requires the container to be relatively positioned and dedicated to the chart canvas only". Set `maintainAspectRatio: false` to control height from CSS (https://www.chartjs.org/docs/latest/configuration/responsive.html).
- Formatter: `ticks.callback(value, index, ticks)` (https://www.chartjs.org/docs/latest/axes/labelling.html) and tooltip `callbacks.label`.
- Theming is the weak point for us. Canvas colours are JS values, so dark mode means reading `getComputedStyle` and calling `chart.update()` when the theme changes.

### visx 4.0.0

- "a collection of reusable low-level visualization components" that is "largely unopinionated" (visx README, `airbnb/visx`). Released 2026-06-11, repo last pushed 2026-06-22. Maintained, but much slower than Recharts or Chart.js.
- `Axis` `tickFormat` takes "a d3 formatter" function (`packages/visx-axis/src/types.ts`), so `formatAmount` fits.
- Smallest library option (+25 kB gzipped). But we still write the layout, accessibility, tooltips and responsiveness ourselves. It mainly saves the scale and tick maths, which is the easy part of the hand-rolled option.

### Nivo 0.99.0

- Last release 2025-05-23, 18 months ago. Still at 0.x. Pulls in `@react-spring/web`, `lodash` and d3. About 90 kB gzipped for `@nivo/bar` alone (bundlephobia), with a line chart on top of that. It has no clear advantage over Recharts, and its releases are slower. Not measured further.

## Bundle-size method

bundlephobia figures (`https://bundlephobia.com/api/size?package=<name>@<version>`) measure the whole package entry, gzipped: recharts 177 kB, chart.js 70.6 kB, react-chartjs-2 1.0 kB, @visx/shape 10.7 kB, @visx/scale 17.5 kB, @visx/axis 15.0 kB, @nivo/bar 89.7 kB, echarts 368 kB.

To see what our charts would actually cost after tree-shaking, I bundled one minimal entry per library in a scratch folder outside the repo (esbuild, minified, production React 19, `gzip -9`). Each entry renders a bar chart and a line chart with axes, tooltip and legend where the library has them:

| Entry | Minified | Gzipped | Added over React alone |
|---|---|---|---|
| React 19 + react-dom only | 223 kB | 69 kB | — |
| + Recharts | 696 kB | 207 kB | +138 kB |
| + Chart.js (registered parts only) + react-chartjs-2 | 402 kB | 131 kB | +62 kB |
| + visx shape/scale/axis/group | 294 kB | 94 kB | +25 kB |

Hand-rolled SVG for three charts is estimated at 2–4 kB gzipped. It was not measured.

Offline: every candidate ships as an npm package that Vite bundles, so none needs a CDN at runtime. Whatever is bundled gets precached by the PWA service worker, so size matters for the first install and for JS parse time on the phone, not for whether the app works offline.

## Sources

- npm registry metadata (`npm view <pkg> version time dependencies peerDependencies types`), 2026-11-25.
- GitHub API `repos/{recharts/recharts, chartjs/Chart.js, reactchartjs/react-chartjs-2, airbnb/visx, plouc/nivo, apache/echarts}`, 2026-11-25.
- bundlephobia size API, 2026-11-25.
- Recharts API docs: BarChart, YAxis.
- Chart.js docs: Accessibility, Integration, Responsive, Labelling.
- visx README and `packages/visx-axis/src/types.ts`.
