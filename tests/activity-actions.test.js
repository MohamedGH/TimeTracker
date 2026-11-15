import { describe, it, expect } from 'vitest';
import { updateActivityAndEntries } from '../src/state/activity-actions.js';

describe('activity-actions (updateActivityAndEntries)', () => {
  const baseActivities = [
    { id: 'act-1', label: 'Code Frontend', categoryId: 'dev', useCount: 4 },
    { id: 'act-2', label: 'Course à pied', categoryId: 'sport', useCount: 2 },
  ];

  const baseEntries = [
    { id: 'e-1', activity: 'Code Frontend', categoryId: 'dev', date: '2026-11-14', start: '09:00', end: '10:00', mins: 60 },
    { id: 'e-2', activity: 'code frontend', categoryId: 'dev', date: '2026-11-13', start: '14:00', end: '15:00', mins: 60 },
    { id: 'e-3', activity: 'Revue PR', categoryId: 'travail', date: '2026-11-14', start: '11:00', end: '11:30', mins: 30 },
  ];

  it('renames and moves a saved activity along with matching entries and active timer', () => {
    const activeTimer = { activity: 'Code Frontend', categoryId: 'dev', date: '2026-11-14', startTime: '16:00', startTs: 1000 };
    const result = updateActivityAndEntries(
      { activities: baseActivities, entries: baseEntries, activeTimer },
      {
        activityId: 'act-1',
        oldLabel: 'Code Frontend',
        oldCategoryId: 'dev',
        newLabel: 'UI Engineering',
        newCategoryId: 'travail',
      }
    );

    const updatedAct = result.activities.find(a => a.id === 'act-1');
    expect(updatedAct.label).toBe('UI Engineering');
    expect(updatedAct.categoryId).toBe('travail');

    expect(result.entries[0].activity).toBe('UI Engineering');
    expect(result.entries[0].categoryId).toBe('travail');
    expect(result.entries[1].activity).toBe('UI Engineering');
    expect(result.entries[1].categoryId).toBe('travail');
    // Unrelated entry untouched
    expect(result.entries[2].activity).toBe('Revue PR');

    // Active timer synchronized
    expect(result.activeTimer.activity).toBe('UI Engineering');
    expect(result.activeTimer.categoryId).toBe('travail');
  });

  it('updates entry-derived activity even when no saved activity record exists', () => {
    const result = updateActivityAndEntries(
      { activities: baseActivities, entries: baseEntries, activeTimer: null },
      {
        activityId: null,
        oldLabel: 'Revue PR',
        oldCategoryId: 'travail',
        newLabel: 'Code Review',
        newCategoryId: 'dev',
      }
    );

    expect(result.activities).toHaveLength(2);
    const updatedEntry = result.entries.find(e => e.id === 'e-3');
    expect(updatedEntry.activity).toBe('Code Review');
    expect(updatedEntry.categoryId).toBe('dev');
  });

  it('deduplicates saved activities when renaming merges with an existing one in target category', () => {
    const duplicateCandidate = [
      ...baseActivities,
      { id: 'act-3', label: 'UI', categoryId: 'dev', useCount: 1 },
    ];
    const result = updateActivityAndEntries(
      { activities: duplicateCandidate, entries: baseEntries, activeTimer: null },
      {
        activityId: 'act-1',
        oldLabel: 'Code Frontend',
        oldCategoryId: 'dev',
        newLabel: 'UI',
        newCategoryId: 'dev',
      }
    );

    expect(result.activities.filter(a => a.label === 'UI' && a.categoryId === 'dev')).toHaveLength(1);
  });

  it('throws when newLabel is empty', () => {
    expect(() =>
      updateActivityAndEntries(
        { activities: baseActivities, entries: baseEntries },
        { activityId: 'act-1', oldLabel: 'Code Frontend', oldCategoryId: 'dev', newLabel: '   ', newCategoryId: 'dev' }
      )
    ).toThrow('Le nom de l’activité ne peut pas être vide.');
  });
});
