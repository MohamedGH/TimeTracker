# User Behavior Tracking & Semantic Event Graph

This sits **above** the GA4 analytics abstraction (`src/core/analytics/`) and does not replace it. GA4 answers "how many people did X" for the business events already catalogued in `docs/ANALYTICS.md`. This system answers a different question — "what sequences of actions do people actually take, where do they get stuck, and what would a feature that shortcuts that look like" — entirely from **on-device** data, with nothing sent anywhere by default.

## Architecture

```
User interaction
    ↓
Behavior Tracker         src/core/behavior/behavior-tracker.js   (only module touching the DOM)
    ↓
Semantic Event           src/core/behavior/semantic-event.js     (typed, sanitized fact)
    ↓
Event Store               src/core/behavior/event-store.js        (append-only, IndexedDB)
    ↓
Semantic Event Graph      src/core/behavior/event-graph.js         (in-memory, incremental)
    ↓
Pattern Detection          src/core/behavior/pattern-detection.js   (sequences, repetition, abandonment)
    ↓
AI Feature Discovery       ← NOT built yet. Pattern Detection stops at producing FEATURE_CANDIDATE
                               hypotheses with support counts; a human (or a future model) reviews them.
```

`src/core/behavior/index.js` wires the pieces together: `initBehaviorTracking({ root })` creates an Event Store, a live Event Graph, and a Behavior Tracker attached to the DOM root — gated by the **same consent decision** as GA4 (`core/analytics/consent.js`). One banner, one decision, covers both. Unlike GA4, this needs no external id/key: everything stays in the browser's IndexedDB (`behavior-events` object store, alongside the app's existing data store — see `src/core/storage.js`). On startup it also hydrates the graph from everything already in that store, and schedules Pattern Detection to keep re-running in the background — see "Pattern Detection → Feature Candidates" below.

## From raw interaction to Semantic Event

Raw DOM noise is never stored. The Behavior Tracker collapses everything into a small, typed event before it goes anywhere:

```js
{
  type: 'interaction',
  action: 'click',
  target: 'export-button',
  context: 'orders',
  object: null,
  previousAction: 'filter',
  timeSincePreviousAction: 2400,
  sessionId: '…', userId: '…', timestamp: …,
  workflowId: null,
  metadata: {},
}
```

- `target`, `context`, `object`, and `metadata` values are never taken from free text, DOM `textContent`, or input `.value`. Only identifier-shaped strings pulled from explicit `data-behavior-*` attributes are accepted (`src/core/behavior/sanitize.js` enforces this — anything that isn't `/^[a-z0-9][a-z0-9_-]*$/i` is dropped, not truncated-and-kept).
- `previousAction` / `timeSincePreviousAction` are computed automatically per session by the tracker, giving every event its place in a sequence and its timing gap for free.

## What's tracked, and how

| Category | How | Notes |
|---|---|---|
| **Click** | Delegated `click` listener on the app root; only elements with `data-behavior-target="…"` are tracked | Nothing is captured "by accident" — an element has to opt in |
| **Navigation** | `tracker.trackNavigation(context)`, called by `src/ui.js` on every tab change (there is no URL router — see `docs/REFACTORING.md`) | Also sets the ambient `context` used by subsequent clicks |
| **Form interaction** | `focusin` delegation on `[data-behavior-field]` inside `[data-behavior-form]` → `form_focus` (field *role*, e.g. `"activity"`, never its value); explicit `tracker.trackFormResult(formId, 'success'\|'error', { code })` calls at the exact point `src/ui.js` already knows the outcome | Wired for the entry form, the "new saved activity" modal, the category create/rename modal, and data import |
| **Search** | `tracker.trackSearch(target, { resultCount })` — query text is never captured, only whether it produced results | API exists; not wired to a fake feature since the app has no dedicated search today (only the activity autocomplete, which is out of scope for this pass) |
| **Drag & drop** | `tracker.trackDragDrop(...)` — implemented, **not wired to any listener** | The app has no drag-and-drop feature yet; wiring a fake source would violate "don't invent events for features that don't exist" |
| **Hover / attention** | `mouseenter`/`mouseleave` dwell timer (1.2s threshold) on `[data-behavior-target]` elements, bucketed (`short`/`medium`/`long`) | No `mousemove` listener anywhere — dwell only needs enter/leave, so there is nothing to throttle in the first place |
| **User errors** | `window.addEventListener('error'/'unhandledrejection')` → `js_error` with only `error.name` (e.g. `"TypeError"`), never the message (which could echo back user input) | Complements `trackFormResult(..., 'error', { code })` for expected validation failures |
| **Sequences / time between actions** | Built into every event via `previousAction` / `timeSincePreviousAction` | No separate listener — it's a property of `record()` |
| **Repetition** | `detectRepetitions()` in Pattern Detection, not the tracker itself | Same `(action, target)` repeated ≥3 times within 4s by one user → a cluster (frustration/"rage click" signal) |
| **Workflow abandonment** | `detectAbandonment()` in Pattern Detection | A `form_focus` with no matching `form_submit_success` in the same context within 60s |

## Semantic Event Graph

An in-memory, incrementally-built graph (`createEventGraph()` / `buildEventGraph(events)`), aggregating facts rather than storing one node per event — there is a single `ACTION` node for `"click"` whose weight grows every time anyone clicks anything, not one node per click.

**Node types:** `USER`, `SESSION`, `ACTION`, `TARGET`, `OBJECT`, `CONTEXT`, `WORKFLOW`, `INTENT`, `PROBLEM`, `FEATURE_CANDIDATE`

**Relationships and what they mean here:**

| Relationship | From → To | Meaning |
|---|---|---|
| `PERFORMS` | USER → ACTION | This user has performed this action type (weighted by count) |
| `PART_OF` | SESSION → USER | This session belongs to this user; also ACTION → WORKFLOW once a sequence is recognized |
| `TARGETS` | ACTION → TARGET | This action type targets this UI element |
| `OPERATES_ON` | ACTION → OBJECT | This action type acts on this domain object type |
| `OCCURS_IN` | ACTION → CONTEXT | This action type happens in this section of the app |
| `FOLLOWS` / `PRECEDES` | ACTION ↔ ACTION | Sequential relationship between two action types, with aggregated average/min/max gap (ms) and an occurrence weight — both directions are stored explicitly for convenient traversal either way |
| `INDICATES` | ACTION → PROBLEM, WORKFLOW → INTENT | An observed fact indicates an underlying condition (friction, or inferred purpose) |
| `SUGGESTS` | WORKFLOW → FEATURE_CANDIDATE, INTENT → FEATURE_CANDIDATE, PROBLEM → FEATURE_CANDIDATE | A hypothesis, never an instruction — see below |

## Pattern Detection → Feature Candidates

`detectSequencePatterns(events, { sequenceLengths, minSupportUsers })` mines n-grams (bigrams/trigrams by default) of action types per session, and keeps only those observed across at least `minSupportUsers` distinct (pseudonymous) users. `applyPatternsToGraph(graph, patterns)` then writes each surviving pattern into the graph as a `WORKFLOW` (+ an `INTENT` derived from it), pointing via `SUGGESTS` at a `FEATURE_CANDIDATE` node with `status: 'hypothesis'` — this status is never changed automatically; nothing here files a ticket or ships a feature on its own.

The graph builds up **progressively**, not just on demand: `initBehaviorTracking()` schedules `runPatternDetection()` to re-run automatically in the background (every 5 minutes by default, skipped if a previous run is still in flight), on top of also hydrating the graph from the full persisted history at startup — so the longer the app is used, the more the graph (and its `FEATURE_CANDIDATE` hypotheses) reflects real usage, without anything needing to trigger it by hand. Pass `patternDetectionIntervalMs: 0` to `initBehaviorTracking()` to disable this and drive detection manually instead.

`getFeatureCandidates({ limit })` returns the current hypotheses as plain objects, ranked by support (highest first) — the shape a future AI Feature Discovery step, or a human triaging a backlog, would actually consume:

```js
getFeatureCandidates()
// → [{ id: 'simplify_search_then_filter_then_export',
//      description: '847 utilisateurs répètent ce workflow : search → filter → export. …',
//      supportUsers: 847, status: 'hypothesis' }, …]
```

**This is now surfaced in the app**, read-only: the dashboard tab shows a "Suggestions détectées (bêta)" card (`insightsCard()` in `src/ui.js`) listing up to 5 candidates by support, each labeled "hypothèse non appliquée automatiquement". Opening the dashboard triggers a fresh `runPatternDetection()` pass (throttled to once per 10s to avoid re-running it on every unrelated rerender while the tab stays open); nothing else in the app reacts to what it finds. If behavior tracking isn't active (no consent), the card explains that instead of showing stale or empty data silently.

This reproduces the example from the design brief directly:

```js
detectSequencePatterns(events, { sequenceLengths: [3], minSupportUsers: 2 })
// → [{ sequence: ['search', 'filter', 'export'], supportUsers: 847, supportSessions: 850, occurrences: 861, avgGapMs: 2400 }]

describeFeatureCandidate(pattern)
// → "847 utilisateurs répètent ce workflow : search → filter → export.
//    Une fonctionnalité combinant ces étapes pourrait simplifier ce comportement."
```

`applyAbandonmentToGraph(graph, abandonments)` does the analogous thing for friction: it creates a `PROBLEM` node once enough distinct users abandon the same action in the same context, and a `FEATURE_CANDIDATE` suggesting the friction point be looked at.

**What's intentionally not built yet:** an AI/LLM step that reads the graph, ranks `FEATURE_CANDIDATE` nodes, writes a product brief, or otherwise closes the loop. The graph and pattern layer above are the *input* that step will need — every node the design brief asked for (support counts, timing, sequence membership) is already there and unit-tested; wiring a model on top is future work.

## Privacy

Same non-negotiables as the analytics layer (`docs/ANALYTICS.md`), enforced independently here too:

- **Never stored:** passwords, tokens, banking data, form field *values*, or any other free-text/sensitive field content.
- Only identifier-shaped strings survive `sanitize.js` — free text is dropped outright, not truncated. A denylist (`password`, `token`, `email`, `note`, `content`, `query`, …) is checked in addition, as a second line of defense.
- Error events store only `error.name` (e.g. `"TypeError"`), never `error.message`, since a message can echo back whatever the user typed.
- No `mousemove` or scroll sampling of any kind — see the Hover row above.
- All identifiers are pseudonymous and local: `userId` is a random UUID in `localStorage` (`src/core/behavior/ids.js`), unrelated to any account; `sessionId` rotates after 30 minutes of inactivity. Neither is ever sent to GA4 or anywhere off-device by this system.
- Gated by the same consent banner as GA4 — declining it means zero behavior events are recorded, not just zero events sent remotely.
- The IndexedDB event store is capped (`pruneBehaviorEvents`, default 5000 events) so local storage doesn't grow unbounded.

## Testing

`tests/behavior/*.test.js` covers: semantic event validation and sanitization (including that a password/free-text field never survives), the graph's node/edge aggregation and `FOLLOWS`/`PRECEDES` timing math, the event store against `fake-indexeddb`, DOM delegation (click/form/hover) with an assertion that raw values never leak into the stored event, and the sequence/repetition/abandonment detectors including the literal "Search → Filter → Export" example from the design brief.

```bash
npm install
npm run lint
npm test
```
