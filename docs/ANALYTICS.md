# Analytics (GA4)

## Architecture

```
UI / Feature
    ↓
analytics.trackEvent(...)         src/core/analytics/analytics.js  (GA4-agnostic)
    ↓
Analytics abstraction             consent.js, env.js, events.js
    ↓
GA4 adapter                       src/core/analytics/ga4-adapter.js (only module that knows GA4)
    ↓
Google Analytics
```

- **`src/core/analytics/analytics.js`** — the only module UI code should import. Exposes `initAnalytics()`, `trackEvent(name, parameters)`, `trackPageView(pageTitle, parameters)`. It never throws, and never depends on GA4 directly. It can be pointed at a different adapter (e.g. a self-hosted backend) later without touching any UI code.
- **`src/core/analytics/ga4-adapter.js`** — the only module allowed to reference `gtag`/`googletagmanager.com`. Loads the GA4 script lazily, only once `initAnalytics()` decides analytics should run.
- **`src/core/analytics/consent.js`** — stores the user's consent decision (`granted` / `denied` / no decision yet) in `localStorage`, independent of the app's IndexedDB storage.
- **`src/core/analytics/env.js`** — resolves the GA4 Measurement ID from environment configuration only (see "Environment variables" below). Never hardcoded.
- **`src/core/analytics/events.js`** — the canonical, documented catalog of business events and their payload builders.

## Consent

No event is ever sent before the user has explicitly opted in.

- On first load, if no consent decision exists yet, `src/ui.js` shows a banner ("Accepter" / "Refuser") instead of the app header.
- Choosing **Refuser** stores `denied` and analytics never initializes for the rest of the session.
- Choosing **Accepter** stores `granted` and calls `initAnalytics()`, which then loads GA4 (if a Measurement ID is configured).
- The decision is stored in `localStorage` under the key `time-tracker:analytics-consent` and is remembered across sessions until cleared.

## Graceful degradation

The app behaves identically whether or not analytics is active:

- No consent decision, or consent denied → `trackEvent()` calls are no-ops.
- Consent granted but no `GA4_MEASUREMENT_ID` configured → `initAnalytics()` returns without creating an adapter; `trackEvent()` calls are no-ops.
- GA4 script fails to load (network/adblock) → the adapter promise rejects, `initAnalytics()` catches it, logs a `console.warn`, and analytics stays disabled for the session.
- Any error while sending an event is caught and logged; it never propagates to the caller.

## Environment variables

The GA4 Measurement ID is never hardcoded in source. Two sources are supported, in this priority order:

| Source | When it applies | How to set it |
|---|---|---|
| `import.meta.env.VITE_GA4_MEASUREMENT_ID` | Once the app is built with Vite (see `docs/REFACTORING.md`, Phase 5 — not yet done) | Copy `.env.example` to `.env` (gitignored) and fill in the value |
| `window.__TIME_TRACKER_ENV__.GA4_MEASUREMENT_ID` | **Today's** deployment: plain ES modules, no bundler | Copy `env.example.js` to `env.js` (gitignored) and load it in `time-tracker_1.html` before `src/main.js`: `<script src="env.js"></script>` |

If neither is set, GA4 stays disabled and the app runs normally.

## Privacy

- **No free-text or user-authored content is ever sent.** Activity names, saved-activity labels, and category labels never leave the device via analytics. Event payloads only carry structural facts: durations (minutes), counts, booleans, and opaque category depth — never labels or ids that could identify a person's personal notes.
- `trackEvent()` additionally strips a denylist of likely-sensitive parameter keys (`activity`, `label`, `name`, `title`, `email`, `password`, `token`, `note`, `notes`, `comment`) as a defensive last line, even if a caller passed them by mistake.
- Nested objects/arrays in parameters are dropped entirely (GA4 event parameters must be flat, and nesting is where unreviewed content is most likely to leak in).
- `anonymize_ip: true` is set on the GA4 config call.
- IP anonymization and the above still mean GA4 itself processes standard web analytics signals (device/browser info, approximate location, etc.) per Google's own policies — this document covers what *this application* chooses to send, not Google's platform-level processing.

## Events

There is no URL router in this app (navigation is tab-based, see `docs/REFACTORING.md`). `page_view` is fired on every tab switch instead of a route change.

| Event | Fired when | Parameters |
|---|---|---|
| `page_view` | The active tab changes (Saisie / Tableau de bord / Catégories), including the initial view on load | `page_title`: `'entry' \| 'dashboard' \| 'categories' \| 'unknown'` |
| `timer_started` | The user starts a timer (from the entry form or from a saved activity) | `has_category`: boolean |
| `timer_stopped` | The user stops the active timer | `duration_minutes`: non-negative integer, `has_category`: boolean |
| `time_entry_created` | A new time entry is saved, either from the manual entry form or automatically when a timer is stopped | `duration_minutes`: non-negative integer, `has_category`: boolean, `via_timer`: boolean |
| `time_entry_updated` | An existing time entry is edited and saved | `duration_minutes`: non-negative integer, `has_category`: boolean |
| `time_entry_deleted` | A time entry is deleted from the list | *(none)* |
| `saved_activity_created` | A new saved activity is added | `has_category`: boolean |
| `saved_activity_started` | A timer is started from a saved activity's "Démarrer" button | *(none)* |
| `saved_activity_deleted` | A saved activity is removed | *(none)* |
| `category_created` | A new category or subcategory is created | `depth`: non-negative integer (0 = root) |
| `category_renamed` | A category is renamed | *(none)* |
| `category_moved` | A category is moved to a new parent (Vue category tree UI, `src/stores/categories.ts`) | `depth`: non-negative integer, new depth after the move |
| `category_deleted` | A category is deleted | `cascade`: boolean, `descendant_count`: non-negative integer |
| `dashboard_period_changed` | The dashboard period filter changes | `period`: `'7' \| '14' \| '30' \| '90' \| 'unknown'` |
| `data_exported` | The user exports their data as JSON | `entry_count`: non-negative integer, `category_count`: non-negative integer |
| `data_imported` | The user imports a JSON backup | `entry_count`: non-negative integer, `category_count`: non-negative integer (post-import totals) |
| `data_cleared` | The user clears all local data | *(none)* |

No events were invented for features that don't exist in the app (e.g. there is no search, no notifications, no auth — none of those are tracked).

## Testing

`tests/consent.test.js`, `tests/env.test.js`, `tests/events.test.js`, `tests/analytics.test.js`, `tests/ga4-adapter.test.js` cover: consent gating, graceful degradation (no ID / adapter throws / script fails to load), event sanitization (denylisted keys, nested values, string length), queueing before init resolves, and the GA4 script-loading contract (URL, `send_page_view: false`, forwarding to `gtag`).

Run with:

```bash
npm install
npm run lint
npm test
```
