import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeSavedActivity } from '../src/core/saved-activities.js';
import { createTimeEntry, isTimeEntry } from '../src/core/time-entry.js';
import { createActiveTimer, timerToEntry } from '../src/core/timer.js';
import { appReducer, ACTION_TYPES } from '../src/core/state-manager.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';
import { updateActivityAndEntries, upsertActivityContent } from '../src/state/activity-actions.js';
import { searchLaunchableActivities } from '../src/core/shortcuts-by-category.js';
import { clearAllData } from '../src/core/storage.js';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';

describe('activity content, startContent / endContent & searchLaunchableActivities', () => {
  it('preserves optional content, startContent and endContent across saved activities, timers, and entries', () => {
    const saved = normalizeSavedActivity({
      id: 'act-doha',
      label: 'Prière Doha',
      categoryId: 'autre',
      content: '  Sourate Ad-Duha + rappel  ',
      startContent: '  Doua à dire au début  ',
      endContent: '  Doua à dire à la fin  ',
    }, DEFAULT_CATEGORIES);
    expect(saved.content).toBe('Sourate Ad-Duha + rappel');
    expect(saved.startContent).toBe('Doua à dire au début');
    expect(saved.endContent).toBe('Doua à dire à la fin');

    const plainSaved = normalizeSavedActivity({ id: 'act-2', label: 'Marche', content: '   ', startContent: '   ' }, DEFAULT_CATEGORIES);
    expect(plainSaved.content).toBeUndefined();
    expect(plainSaved.startContent).toBeUndefined();

    const timer = createActiveTimer({
      activity: 'Prière Doha',
      categoryId: 'autre',
      date: '2026-11-26',
      startTime: '08:00',
      startTs: 1000,
      content: saved.content,
      startContent: saved.startContent,
      endContent: saved.endContent,
    });
    expect(timer.content).toBe('Sourate Ad-Duha + rappel');
    expect(timer.startContent).toBe('Doua à dire au début');
    expect(timer.endContent).toBe('Doua à dire à la fin');

    const entry = timerToEntry(timer, '08:20', '2026-11-26', 'e-doha');
    expect(isTimeEntry(entry)).toBe(true);
    expect(entry.content).toBe('Sourate Ad-Duha + rappel');
    expect(entry.startContent).toBe('Doua à dire au début');
    expect(entry.endContent).toBe('Doua à dire à la fin');

    const manual = createTimeEntry({
      activity: 'Lecture',
      date: '2026-11-26',
      start: '10:00',
      end: '10:30',
      content: ' Notes permanentes ',
      startContent: ' Intention ',
      endContent: ' Résumé ',
    });
    expect(manual.content).toBe('Notes permanentes');
    expect(manual.startContent).toBe('Intention');
    expect(manual.endContent).toBe('Résumé');
  });

  it('auto-resolves permanent and start/end content across START_TIMER, STOP_TIMER, RECONCILE_NATIVE_TIMER, and upsertActivityContent', () => {
    const initial = {
      entries: [],
      categories: [...DEFAULT_CATEGORIES],
      activities: [
        {
          id: 'act-1',
          label: 'Doha',
          categoryId: 'autre',
          useCount: 1,
          content: 'Checklist permanente Doha',
          startContent: 'Dire Bismillah',
          endContent: 'Dire Alhamdulillah',
        },
      ],
      activeTimer: null,
    };

    const started = appReducer(initial, {
      type: ACTION_TYPES.START_TIMER,
      payload: {
        activity: 'Doha',
        categoryId: 'autre',
        date: '2026-11-26',
        startTime: '09:00',
        startTs: Date.now() - 10 * 60000,
      },
    });
    expect(started.activeTimer.content).toBe('Checklist permanente Doha');
    expect(started.activeTimer.startContent).toBe('Dire Bismillah');
    expect(started.activeTimer.endContent).toBe('Dire Alhamdulillah');

    const edited = updateActivityAndEntries(started, {
      activityId: 'act-1',
      oldLabel: 'Doha',
      oldCategoryId: 'autre',
      newLabel: 'Doha Matin',
      newCategoryId: 'autre',
      content: 'Nouvelle checklist permanente',
      startContent: 'Nouvelle doua début',
      endContent: 'Nouvelle doua fin',
    });
    expect(edited.activities[0].content).toBe('Nouvelle checklist permanente');
    expect(edited.activities[0].startContent).toBe('Nouvelle doua début');
    expect(edited.activeTimer.activity).toBe('Doha Matin');
    expect(edited.activeTimer.content).toBe('Nouvelle checklist permanente');
    expect(edited.activeTimer.startContent).toBe('Nouvelle doua début');
    expect(edited.activeTimer.endContent).toBe('Nouvelle doua fin');

    const stopped = appReducer(edited, {
      type: ACTION_TYPES.STOP_TIMER,
      payload: { end: '09:10' },
    });
    expect(stopped.entries[0].content).toBe('Nouvelle checklist permanente');
    expect(stopped.entries[0].startContent).toBe('Nouvelle doua début');
    expect(stopped.entries[0].endContent).toBe('Nouvelle doua fin');

    const reconciled = appReducer(stopped, {
      type: ACTION_TYPES.RECONCILE_NATIVE_TIMER,
      payload: {
        activeTimer: {
          activity: 'Doha Matin',
          categoryId: 'autre',
          date: '2026-11-26',
          startTime: '10:00',
          startTs: Date.now(),
        },
      },
    });
    expect(reconciled.activeTimer.content).toBe('Nouvelle checklist permanente');
    expect(reconciled.activeTimer.startContent).toBe('Nouvelle doua début');
    expect(reconciled.activeTimer.endContent).toBe('Nouvelle doua fin');

    // upsertActivityContent creates saved activity when missing and syncs activeTimer
    const freshSlice = {
      activities: [],
      entries: [],
      activeTimer: createActiveTimer({
        activity: 'Méditation',
        categoryId: 'autre',
        date: '2026-11-26',
        startTime: '11:00',
        startTs: Date.now(),
      }),
    };
    const upserted = upsertActivityContent(freshSlice, {
      label: 'Méditation',
      categoryId: 'autre',
      content: 'Respiration 4-7-8',
    });
    expect(upserted.activities).toHaveLength(1);
    expect(upserted.activities[0].content).toBe('Respiration 4-7-8');
    expect(upserted.activeTimer.content).toBe('Respiration 4-7-8');
  });

  it('searches activities accent-insensitively by name, category path, or permanent/start/end content', () => {
    const categories = [
      { id: 'spirituel', label: 'Spirituel', color: '#5C7A5E', parentId: null },
      { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null },
    ];
    const activities = [
      {
        id: 'a1',
        label: 'Prière Doha',
        categoryId: 'spirituel',
        content: 'Réciter deux rakat sereinement',
        startContent: 'Doua ouverture à réciter',
        endContent: 'Doua clôture',
      },
      {
        id: 'a2',
        label: 'Revue Code',
        categoryId: 'travail',
      },
    ];
    const entries = [
      { id: 'e1', activity: 'Revue Code', categoryId: 'travail', date: '2026-11-25', start: '10:00', end: '10:30', mins: 30 },
    ];

    const byName = searchLaunchableActivities({ query: 'priere', entries, activities, categories });
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe('Prière Doha');
    expect(byName[0].content).toBe('Réciter deux rakat sereinement');
    expect(byName[0].startContent).toBe('Doua ouverture à réciter');

    const byAlwaysContent = searchLaunchableActivities({ query: 'sereinement', entries, activities, categories });
    expect(byAlwaysContent).toHaveLength(1);
    expect(byAlwaysContent[0].name).toBe('Prière Doha');

    const byContent = searchLaunchableActivities({ query: 'cloture', entries, activities, categories });
    expect(byContent).toHaveLength(1);
    expect(byContent[0].name).toBe('Prière Doha');

    const byCategory = searchLaunchableActivities({ query: 'travail', entries, activities, categories });
    expect(byCategory.some(r => r.name === 'Revue Code')).toBe(true);
  });
});

describe('UI activity content, permanent content & launch-from-search workflow', () => {
  beforeEach(async () => {
    await clearAllData();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '';
  });

  it('creates an activity with start/end content, launches chrono from search, and shows start/end prompts', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // 1. Navigate to Activities page and create a saved activity with startContent and endContent
    root.querySelector('#nav-activities')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-behavior-target="activity-add-open"]')).toBeTruthy();
    });
    root.querySelector('[data-behavior-target="activity-add-open"]').click();

    const modalForm = root.querySelector('[data-behavior-form="activity-form"]');
    modalForm.querySelector('[data-behavior-field="label"]').value = 'Doha';
    modalForm.querySelector('[data-behavior-field="start-content"]').value = 'Doua de début : Bismillah';
    modalForm.querySelector('[data-behavior-field="end-content"]').value = 'Doua de fin : Alhamdulillah';
    modalForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(app.state.activities.some(a => a.label === 'Doha')).toBe(true);
      expect(root.textContent).toContain('Doua de début : Bismillah');
    });

    // 2. Return to Entry page, search "Doha", and launch chronometer directly from search result
    root.querySelector('#nav-entry').click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-behavior-target="activity-chrono-search"]')).toBeTruthy();
    });
    const searchInput = root.querySelector('[data-behavior-target="activity-chrono-search"]');
    searchInput.value = 'doha';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    const launchBtn = root.querySelector('[data-behavior-target="search-launch-chrono"]');
    expect(launchBtn).toBeTruthy();
    launchBtn.click();

    // 3. Running timer displays start & end content blocks
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeTruthy();
      expect(app.state.activeTimer.activity).toBe('Doha');
      expect(root.querySelector('[data-timer-content-kind="start"]')).toBeTruthy();
    });
    expect(root.querySelector('[data-timer-content-kind="start"]').textContent).toContain('Doua de début : Bismillah');
    expect(root.querySelector('[data-timer-content-kind="end"]').textContent).toContain('Doua de fin : Alhamdulillah');

    // 4. Stop timer -> endContent prompt card is shown cleanly and entry preserves content
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('[data-timer-end-prompt="true"]')).toBeTruthy();
    });

    expect(root.querySelector('[data-timer-end-prompt="true"]').textContent).toContain('Doua de fin : Alhamdulillah');
    expect(app.state.entries[0].startContent).toBe('Doua de début : Bismillah');
    expect(app.state.entries[0].endContent).toBe('Doua de fin : Alhamdulillah');

    // Dismissing end prompt hides it
    root.querySelector('[data-behavior-target="timer-end-prompt-dismiss"]').click();
    expect(root.querySelector('[data-timer-end-prompt="true"]')).toBeNull();

    ui.destroy();
    root.remove();
  });

  it('defines permanent content once from running chrono and displays it automatically on all future chronos', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    // Start a plain chronometer for "Lecture Coran" without any pre-defined content
    const entryForm = root.querySelector('[data-behavior-form="entry-form"]');
    entryForm.querySelector('[data-behavior-field="activity"]').value = 'Lecture Coran';
    root.querySelector('[data-behavior-target="timer-start"]').click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Lecture Coran');
      expect(root.querySelector('[data-behavior-target="timer-edit-content"]')).toBeTruthy();
    });
    expect(root.querySelector('[data-timer-content-kind="always"]')).toBeNull();

    // Define permanent content once directly from the running chronometer card
    root.querySelector('[data-behavior-target="timer-edit-content"]').click();
    const modalForm = root.querySelector('[data-behavior-form="activity-form"]');
    expect(modalForm).toBeTruthy();
    modalForm.querySelector('[data-behavior-field="always-content"]').value = 'Lire 2 pages avec tajwid';
    modalForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Current running chronometer immediately displays the permanent content and persists it onto saved activities
    await vi.waitFor(() => {
      expect(root.querySelector('[data-timer-content-kind="always"]')).toBeTruthy();
      expect(root.querySelector('[data-timer-content-kind="always"]').textContent).toContain('Lire 2 pages avec tajwid');
    });
    expect(app.state.activities.some(a => a.label === 'Lecture Coran' && a.content === 'Lire 2 pages avec tajwid')).toBe(true);

    // Stop the first chronometer (wait until timer-active disappears after persist + rerender)
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
    });

    // Launch a fresh chronometer for the same activity from Search
    const searchInput = root.querySelector('[data-behavior-target="activity-chrono-search"]');
    searchInput.value = 'lecture';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-behavior-target="search-launch-chrono"]').click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Lecture Coran');
      expect(root.querySelector('[data-timer-content-kind="always"]')?.textContent).toContain('Lire 2 pages avec tajwid');
    });

    // Stop again and launch via quick shortcut chip -> permanent content is STILL shown automatically
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
      expect(root.querySelector('[data-behavior-target="quick-shortcut-start"]')).toBeTruthy();
    });

    const shortcutBtn = [...root.querySelectorAll('[data-behavior-target="quick-shortcut-start"]')]
      .find(btn => btn.textContent.includes('Lecture Coran'));
    expect(shortcutBtn).toBeTruthy();
    shortcutBtn.click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Lecture Coran');
      expect(root.querySelector('[data-timer-content-kind="always"]')?.textContent).toContain('Lire 2 pages avec tajwid');
    });

    // Stop cleanly so no async persist stays in flight into the next test
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
    });

    ui.destroy();
    root.remove();
  });

  it('defines permanent content once in entryCard with remember checkbox and reuses it on future chronometers', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = await createAppState();
    const ui = createUI({
      root,
      ...app,
      authClient: { isConfigured: () => false, signOut: async () => {} },
    });

    const entryForm = root.querySelector('[data-behavior-form="entry-form"]');
    const actInput = entryForm.querySelector('[data-behavior-field="activity"]');
    actInput.value = 'Révision';
    actInput.dispatchEvent(new Event('input', { bubbles: true }));

    const rememberCb = entryForm.querySelector('[data-behavior-field="remember-activity-content"]');
    expect(rememberCb.checked).toBe(true);
    entryForm.querySelector('[data-behavior-field="always-content"]').value = 'Relire les fiches clés';

    root.querySelector('[data-behavior-target="timer-start"]').click();

    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Révision');
      expect(root.querySelector('[data-timer-content-kind="always"]')?.textContent).toContain('Relire les fiches clés');
    });
    expect(app.state.activities.some(a => a.label === 'Révision' && a.content === 'Relire les fiches clés')).toBe(true);

    // Stop and type the activity name again without re-entering content -> hint shows associated content & new chrono shows it
    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
    });

    const nextForm = root.querySelector('[data-behavior-form="entry-form"]');
    const nextActInput = nextForm.querySelector('[data-behavior-field="activity"]');
    nextActInput.value = 'Révision';
    nextActInput.dispatchEvent(new Event('input', { bubbles: true }));

    const hint = nextForm.querySelector('[data-entry-associated-content="true"]');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Relire les fiches clés');

    root.querySelector('[data-behavior-target="timer-start"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer?.activity).toBe('Révision');
      expect(root.querySelector('[data-timer-content-kind="always"]')?.textContent).toContain('Relire les fiches clés');
    });

    root.querySelector('[data-behavior-target="timer-stop"]').click();
    await vi.waitFor(() => {
      expect(app.state.activeTimer).toBeNull();
      expect(root.querySelector('.timer-active')).toBeNull();
    });

    ui.destroy();
    root.remove();
  });
});
