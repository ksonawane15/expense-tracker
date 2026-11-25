# How reliable is offline storage in an installed PWA?

Research for issue #13 (map #12). Researched 2026-11-25. Platforms: iOS/iPadOS Safari Home Screen web apps, Android Chrome, desktop Chrome/Edge (plus a note on macOS Safari "Add to Dock").

## Bottom line for the storage-and-migration decision

1. **On iPhone, the installed app cannot see data from the Safari tab.** A Home Screen web app gets its own storage container. Nothing is shared with Safari, including v1's `localStorage`. The supported way to move v1 data into the installed app is **export in the Safari tab, then import in the installed app**. Android and desktop Chromium share storage between the tab and the installed app, so v1 data is visible there.
2. **Installing protects against the iOS 7-day wipe.** Safari deletes all script-written storage after 7 days of Safari use without interaction, but Home Screen web apps keep their own day counter and WebKit says it does not expect their first-party data to be deleted. A tab-only user on iPhone is at real risk of losing data.
3. **Call `navigator.storage.persist()` after install.** No platform prompts the user except Firefox. Safari and Chromium decide with heuristics, and both name being installed (Home Screen web app, or installed/bookmarked in Chrome) as a signal. Persistence only exempts the origin from automatic eviction. The user can still clear the data, and uninstalling may or may not remove it. **Export stays the only real backup.**
4. **IndexedDB over localStorage.** Both are covered by the same quota and eviction rules, so neither is "safer". localStorage is about 5 MiB per origin and synchronous. IndexedDB shares the large origin quota (about 60% of disk on Chromium and Safari 17+) and is what web.dev recommends for structured data. A few thousand expenses fit in either. The reasons to switch are headroom for v2's extra records (income, budgets, recurring, tombstones) and not blocking the main thread, not reliability.
5. **Laptop install** (Chrome/Edge) needs HTTPS and a linked manifest with `name`/`short_name`, 192px and 512px `icons`, `start_url` and `display`. A service worker is not required to install from the menu (Chrome 108 mobile, 112 desktop), but one is needed to work offline. Updates arrive when the browser checks the service worker script on navigation (at most once per 24 h for event-triggered checks). The new worker waits until every window of the app is closed, unless the app uses `skipWaiting()` or offers a "reload to update" prompt.

## 1. Quotas: IndexedDB vs localStorage

| | Per-origin quota (IndexedDB, Cache API, etc.) | localStorage |
|---|---|---|
| Chrome / Edge (Chromium) | Up to 60% of total disk per origin, 80% browser-wide. The same in best-effort and persistent mode. | About 5 MiB per origin |
| Safari 17+ (iOS 17, macOS 14) browser app | Up to about 60% of total disk per origin, 80% overall | About 5 MiB per origin |
| iOS Home Screen web app | **Same origin and overall quota as in the browser app** | About 5 MiB per origin |
| Firefox | Best-effort: smaller of 10% of disk or 10 GiB group limit. Persistent: up to 50% of disk. | About 5 MiB per origin |

- WebKit, "Updates to Storage Policy" (2023-08-10): browser-app origin quota "up to 60% of the total disk space". Standalone web apps get the same quotas as the browser app. The quota is an upper bound, so `QuotaExceededError` must still be handled. Covers localStorage, IndexedDB, Cache API, Service Worker and File System. https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN, "Storage quotas and eviction criteria" (last modified 2026-01-05): Chromium 60% per origin in both modes. Web Storage is 5 MiB of local storage per origin, and going over throws `QuotaExceededError`. (The page also says "10 MiB" in one place, so treat 5 MiB as the safe figure.) https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- web.dev, "Storage for the web" (content updated 2024): "LocalStorage should be avoided because it is synchronous and will block the main thread". Use IndexedDB for structured data. Note: its Safari quota figures (about 1 GB, prompts in 200 MB steps) **predate Safari 17 and are outdated**. https://web.dev/articles/storage-for-the-web

## 2. When data is evicted

**Storage-pressure eviction (all browsers).** Best-effort origins are evicted whole, least-recently-used first, when the disk runs low or the browser goes over its overall quota. Origins granted persistence are skipped. Sources: MDN quotas page above, and WebKit 2023 ("the data of an origin will be deleted as a whole").

**Safari's proactive 7-day rule (iOS and macOS Safari).**
- WebKit, "Full Third-Party Cookie Blocking and More" (2020-03-24): all script-writable storage (IndexedDB, LocalStorage, SessionStorage, service worker registrations and cache) is deleted "after seven days of Safari use without user interaction on the site". Days are days of Safari *use*, not calendar days. https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- Same post, on Home Screen apps: "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use." "We do not expect the first-party in such a web application to have its website data deleted."
- MDN (2026) still describes the rule: no click or tap in the last 7 days of browser use with tracking prevention on means script-created data is deleted.
- WebKit 2023 says origins in persistent mode, or with an active page, may be excluded from eviction.
- Caveat: the Home Screen exemption is stated in the 2020 post and repeated by web.dev ("does not apply to installed PWAs"). The 2023 policy post neither restates nor contradicts it. No newer primary source changes it.

## 3. `navigator.storage.persist()`

| Platform | Supported | Prompts user? | How it decides |
|---|---|---|---|
| Chrome / Edge (desktop and Android) | Yes | No | Heuristics: site engagement, "installed or bookmarked", notification permission. Silently denied otherwise, and can be asked again later. |
| Safari / iOS (15.2+, policy described for 17+) | Yes | No | Heuristics "like whether the website is opened as a Home Screen Web App" |
| Firefox | Yes | **Yes**, a permission popup | User choice |

- Chrome: web.dev, "Persistent storage". https://web.dev/articles/persistent-storage
- Safari: WebKit 2023 storage policy post (link above).
- Firefox, and Safari/Chromium "do not show any prompts": MDN quotas page.

**What it guarantees:** the origin is exempt from *automatic* (best-effort) eviction. It does not protect against the user. "It's only deleted if the user chooses to remove it using their site settings" (web.dev). "Users are always in charge, and they can delete the storage at any time" (web.dev Learn PWA, offline data, https://web.dev/learn/pwa/offline-data). There is no way to give persistence back programmatically. Check the result with `navigator.storage.persisted()`, and show usage with `navigator.storage.estimate()`.

Practical consequence: call `persist()` on first run of the installed app (the install signal makes a grant likely on Safari and Chrome). Treat a denial as "nudge the user to export more often", not as an error.

## 4. Is installed-app storage separate from the browser tab?

**iOS / iPadOS: separate, by design.**
- web.dev Learn PWA, Installation: on iOS/iPadOS "Each installation has its own isolated storage and is treated as a different application". https://web.dev/learn/pwa/installation
- WebKit Bugzilla 181849 ("Add to homescreen apps don't share storage with Safari"), still open. Apple engineer, 2022-02-01: "The current behavior (on Apple platforms) is by design. … Home Screen apps are created as isolated entities without shared state with the browser." https://bugs.webkit.org/show_bug.cgi?id=181849
- web.dev "Storage for the web": adding to the Home Screen "creates a new storage container, and nothing is shared between the PWA and mobile Safari."
- iOS 26 / Safari 26 (WebKit, 2025-09-15): every site added to the Home Screen now opens as a web app by default, with a user toggle "Open as Web App". There are "zero requirements for installability", and no manifest or service worker is needed. The post says nothing new about storage, so isolation still applies. https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Since iOS 16.4, Home Screen apps can be added from the share menu of Chrome, Edge, Firefox and Orion too (MDN, below). They are still WebKit Home Screen apps with their own container.

**Consequence for v1 to v2:** v1 data in Safari's `localStorage` is **not visible** to the installed app on iPhone. The user must export from the Safari tab and import into the installed app. The app cannot do this transfer itself. Deleting the Home Screen icon deletes that container, while the Safari copy stays (separate lifetimes).

**macOS Safari "Add to Dock" (Safari 17+):** "Safari will copy the website's cookies to the web app", but "does not copy over any other kind of local storage". After that, no website data is shared. So a laptop running Safari behaves like iOS, and importing is needed. WebKit Safari 17.0 post (2023-09-18): https://webkit.org/blog/14445/webkit-features-in-safari-17-0/

**Android Chrome and desktop Chrome/Edge: shared.** The installed app runs in the same browser profile and origin, so it sees the same IndexedDB and localStorage as a tab. No Chrome or Microsoft doc states this outright. Evidence: web.dev Learn PWA says storage is tied to the origin, and Android shortcut installs "use the same storage". A w3c/manifest issue #989 comment (2026-04-01, https://lists.w3.org/Archives/Public/public-webapps-github/2026Apr/0004.html) says "on Android, and every other OS except iOS, the storage is shared between the browser and the PWA". A 2020 comment from a Chrome engineer on the public-webapps-github list (https://lists.w3.org/Archives/Public/public-webapps-github/2020May/1169.html) reportedly argued against separate storage for installed apps. I found it through search and did not read it in full. **Confidence: high in practice, but lacking a first-party spec statement.**

## 5. Installing on a laptop, and how updates arrive

**Chromium (Chrome, Edge) installability** (MDN, "Making PWAs installable", last modified 2026-10-06, https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable, and web.dev install criteria, https://web.dev/articles/install-criteria):
- Served over HTTPS (or `localhost`).
- `<link rel="manifest">` on every page. The manifest has `name` or `short_name`, `icons` with 192px **and** 512px, `start_url`, `display` (or `display_override`) of `standalone`/`minimal-ui`/`fullscreen`/`window-controls-overlay`, and `prefer_related_applications` absent or `false`.
- The automatic install prompt (`beforeinstallprompt`) also needs engagement: at least one click/tap and 30 seconds on the page.
- Service worker: not required to install from the menu since Chrome 108 (mobile) and 112 (desktop). The Chrome blog said the *install prompt* still expected a `fetch()` handler at that time. https://developer.chrome.com/blog/update-install-criteria . Either way, v2 needs a service worker that caches the app shell to work offline.
- Firefox desktop does not install PWAs. macOS Safari 17+ uses File > Add to Dock for any site, with or without a manifest.

**Service-worker updates** (web.dev, "The service worker lifecycle", https://web.dev/articles/service-worker-lifecycle):
- The browser checks for a new worker on navigation to an in-scope page, and on functional events (push/sync) unless it checked in the last 24 hours. It ignores HTTP caching headers for the worker script by default (`updateViaCache`).
- A worker counts as updated if it is byte-different. The new worker installs, then **waits until no window uses the old one**. A refresh alone is not enough, because an installed app usually has a single long-lived window.
- Options: `self.skipWaiting()` plus `clients.claim()` (activates at once, with a risk of mixing old page and new assets), or detect the waiting worker and show a "new version, reload" prompt. Call `registration.update()` periodically for apps left open a long time.
- Migration impact: a new deployment can run new code against old stored data at any moment after an update. The stored-data `schemaVersion` migration on startup (ADR 0001) remains the mechanism, and it must also cope with a schema change in the middle of a session.

## Open points / not verified

- No first-party Chrome or Edge doc states outright that installed apps share storage with tabs. The evidence is indirect (see §4).
- Whether iOS's 7-day exemption for Home Screen apps also holds when the app is not opened for weeks: WebKit says they have "their own counter of days of use", which suggests days the app is *used*, so an unused app does not count down. Not tested.
- Real-device check worth doing once v2 ships: on iPhone, install, call `persist()`, and log `persisted()` and `estimate()`.
