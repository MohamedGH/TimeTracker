# TimeTracker — refactoring strategy

## Goal

Move the current single-file application toward a maintainable architecture **without changing the user-facing behavior**.

The existing application remains the reference implementation during the migration.

## Target architecture

```text
src/
├── core/
│   ├── model.js       # domain validation and constants
│   ├── time.js        # pure date/time calculations
│   └── storage.js     # IndexedDB adapter
├── state/             # application state and actions
├── ui/                # DOM rendering and event wiring
├── charts/            # Chart.js adapters
└── main.js            # composition root
```

## Phase 1 — domain extraction

Implemented on this branch:

- `src/core/time.js`
- `src/core/storage.js`
- `src/core/model.js`

These modules deliberately contain no rendering code. This makes them testable and prevents business logic from being coupled to the DOM.

### Important improvements

1. **Cross-midnight intervals** are handled by a pure `splitEntryByDay()` function.
2. **IndexedDB access** is isolated behind `getValue`, `setValue` and `removeValue`.
3. An explicit **active timer storage key** is reserved so the running timer can survive a page refresh.
4. Imported backups can be normalized and validated before entering application state.

## Phase 2 — extract application state

Move these globals out of the HTML file:

- `entries`
- `savedActivities`
- `customCategories`
- `subCategories`
- `activeTimer`
- dashboard period state
- modal/edit state

Create a small state/action layer. Rendering should receive state rather than mutate global variables directly.

## Phase 3 — extract UI modules

Recommended order:

1. Entry form
2. Timer
3. Entry list
4. Categories/activity management
5. Dashboard
6. Modal system

The migration should be incremental: extract one responsibility, verify behavior, then continue.

## Phase 4 — security and robustness

- Escape user-controlled strings before inserting them into `innerHTML`.
- Prefer `textContent` where possible.
- Validate imported JSON with the domain model.
- Restore the active timer from IndexedDB on startup.
- Handle IndexedDB failures visibly instead of silently falling back to inconsistent state.

## Phase 5 — build tooling

After the vanilla modules are stable, migrate to Vite + TypeScript only if the project needs a larger component architecture. The current local-first IndexedDB model should remain intact.

## Rule

Do not rewrite the whole application at once. Every migration step must preserve:

- existing entries
- existing categories
- saved activities
- cross-midnight calculations
- dashboard statistics
- import/export compatibility
