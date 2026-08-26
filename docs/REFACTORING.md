# TimeTracker — refactoring strategy

## Goal

Move the current single-file application toward a maintainable architecture **without changing the user-facing behavior**.

The migration is now complete for the vanilla architectural target. The historical `time-tracker_1.html` file is only an application shell; application state, domain logic, persistence, UI rendering and charts live under `src/`.

## Target architecture

```text
src/
├── app-state.js          # application state + persistence composition
├── main.js               # composition root
├── app.css               # presentation styles
├── core/                 # domain, persistence, migration, validation
├── state/                # state actions and stores
├── ui.js                 # DOM rendering and event wiring
└── charts/               # Chart.js adapters
```

## Phase 1 — domain extraction

Completed:

- `src/core/time.js`
- `src/core/storage.js`
- `src/core/model.js`
- time-entry, timer, validation and migration modules

These modules contain no legacy page rendering code. Cross-midnight calculations are handled by `splitEntryByDay()` and IndexedDB is isolated behind the storage adapter.

## Phase 2 — application state

Completed:

- `entries`
- saved activities
- categories
- active timer
- dashboard period
- edit/modal state

Application state is created by `src/app-state.js`. Persistence is performed through the canonical IndexedDB adapter and the existing one-way migration runs before the application state is restored.

## Phase 3 — UI extraction

Completed. The former UI responsibilities are now rendered from `src/ui.js`:

1. Entry form and editing
2. Timer
3. Entry list
4. Saved activities
5. Hierarchical category management
6. Dashboard
7. Modal forms
8. Import/export actions

Charts are isolated in `src/charts/dashboard.js`.

`time-tracker_1.html` no longer contains application JavaScript or UI rendering logic. It only provides the document shell, external dependencies and `src/main.js` entry point.

## Phase 4 — security and robustness

Completed for the extracted runtime:

- User-controlled labels are inserted with `textContent`, not raw `innerHTML`.
- Imported JSON is validated before entering state.
- Legacy persistence is migrated to the canonical category/categoryId schema before startup.
- Active timer state is persisted and restored across refreshes.
- Category deletion updates affected entries and saved activities to an uncategorized state.
- Cross-midnight entries remain supported by the domain time utilities.

## Phase 5 — build tooling

Not required for completion of the vanilla refactoring target. Vite/TypeScript/Vue can be introduced later as a separate modernization step without reintroducing application logic into the HTML shell.

## Completion rule

The architectural refactoring described by this document is considered complete when `time-tracker_1.html` is only a shell and no longer owns application state, persistence, business rules, rendering or event wiring.
