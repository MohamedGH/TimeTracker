/**
 * State contracts used during the vanilla -> Vue/Pinia migration.
 * These factories keep defaults in one place before TypeScript is introduced.
 */

export function createEntriesState() {
  return {
    entries: [],
  };
}

export function createTimerState() {
  return {
    activeTimer: null,
  };
}

export function createCategoriesState() {
  return {
    customCategories: [],
    subCategories: [],
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
