import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LaptopLayoutPrototype from './prototype/LaptopLayoutPrototype.tsx'

// PROTOTYPE gate (issue #20): `?variant=A|B|C` shows the laptop layout prototype in dev builds only.
const showPrototype = import.meta.env.DEV && new URLSearchParams(location.search).has('variant')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showPrototype ? <LaptopLayoutPrototype /> : <App />}</StrictMode>,
)
