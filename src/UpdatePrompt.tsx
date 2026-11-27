import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Registers the service worker that keeps the app working offline, and shows
 * "New version available" once a new version has been downloaded. The new
 * version waits until the user chooses Reload, so an update never interrupts
 * what they are doing.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // An installed app can stay open for days, so look for a new version whenever it comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {})
      })
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-prompt" role="status">
      <p>New version available.</p>
      <div className="data-actions">
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" className="secondary" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  )
}
