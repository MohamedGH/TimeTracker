# State management

Target architecture for the Vue 3 migration:

- Pinia owns shared application state.
- IndexedDB remains the persistence layer.
- Components should not access IndexedDB directly.
- Composables encapsulate reusable reactive behavior.
- Stores expose domain actions rather than leaking persistence details.

Planned stores:

- `entries` — time entries and CRUD operations
- `timer` — active timer and elapsed time
- `categories` — categories, subcategories and saved activities
- `settings` — UI preferences and selected dashboard period

The stores will be introduced after the current domain modules are wired into the legacy application. This keeps the migration incremental and avoids duplicating state during the transition.
