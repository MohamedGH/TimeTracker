/**
 * State contracts used during the vanilla -> Vue/Pinia migration.
 */

export function createEntriesState() {
  return { entries: [] };
}

export function createTimerState() {
  return { activeTimer: null };
}

export function createCategoriesState() {
  return {
    // One flat collection representing an unlimited-depth tree.
    categories: [],
    savedActivities: [],
  };
}

export function createSettingsState() {
  return {
    activeTab: 'entries',
    periodMode: '7d',
    customStart: null,
    customEnd: null,
    selectedArcDate: null,
    showAllEntries: false,
  };
}
