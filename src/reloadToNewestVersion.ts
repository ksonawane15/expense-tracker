/**
 * Reloads into the newest version of the app: a downloaded version that is
 * waiting takes over first, so the reload doesn't come back to this old one.
 */
export async function reloadToNewestVersion() {
  const registration = await navigator.serviceWorker?.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) {
    location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}
