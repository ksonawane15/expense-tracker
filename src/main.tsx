import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { openExpenseTracker } from './domain/expenseTracker.ts'
import { createIndexedDbRepository } from './domain/indexedDbRepository.ts'
import { createV1LocalStorageSource } from './domain/v1LocalStorage.ts'

// Opened once, outside React, so a first-run seed or v1 upgrade never runs twice.
const tracker = openExpenseTracker({
  repository: createIndexedDbRepository(),
  v1Source: createV1LocalStorageSource(),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p className="loading">Loading your expenses…</p>}>
      <App tracker={tracker} />
    </Suspense>
  </StrictMode>,
)
