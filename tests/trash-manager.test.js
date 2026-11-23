import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TRASH_ITEM_KINDS,
  createTrashRecord,
  normalizeTrashList,
  pushTrashRecord,
  removeTrashRecord,
  restoreTrashRecord,
} from '../src/core/trash-manager.js';
import { diffAndStampCollection } from '../src/core/sync/crdt-merge.js';
import { createStateManager } from '../src/core/state-manager.js';
import { createUI } from '../src/ui.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

describe('trash-manager pure domain logic', () => {
  it('creates normalized trash records and enforces expiry and maxItems caps', () => {
    const now = 1_700_000_000_000;
    const oldExpired = createTrashRecord({
      kind: TRASH_ITEM_KINDS.ENTRY,
      item: { id: 'e-old', activity: 'Old', date: '2026-01-01', start: '08:00', end: '09:00' },
      deletedAt: now - (31 * 24 * 60 * 60 * 1000),
    });
    const rec1 = createTrashRecord({
      kind: TRASH_ITEM_KINDS.ENTRY,
      item: { id: 'e-1', activity: 'Dev', date: '2026-11-23', start: '09:00', end: '10:00' },
      deletedAt: now - 5000,
    });
    const rec2 = createTrashRecord({
      kind: TRASH_ITEM_KINDS.ACTIVITY,
      item: { id: 'a-1', label: 'Lecture', categoryId: 'etude' },
      deletedAt: now - 1000,
    });

    const normalized = normalizeTrashList([rec1, oldExpired, rec2], { nowMs: now, maxItems: 5 });
    expect(normalized).toHaveLength(2);
    expect(normalized[0].id).toBe(rec2.id); // newest first
    expect(normalized[1].id).toBe(rec1.id);

    const capped = pushTrashRecord([rec1], rec2, { nowMs: now, maxItems: 1 });
    expect(capped).toHaveLength(1);
    expect(capped[0].id).toBe(rec2.id);

    expect(removeTrashRecord(normalized, rec2.id)).toHaveLength(1);
  });

  it('restores deleted entries, activities, templates, and clears CRDT tombstones cleanly', () => {
    const entry = { id: 'e-1', activity: 'Code', categoryId: 'travail', date: '2026-11-23', start: '09:00', end: '10:00', mins: 60, updatedAt: 100 };
    const trashRec = createTrashRecord({ kind: TRASH_ITEM_KINDS.ENTRY, item: entry, deletedAt: 200 });

    // Simulate CRDT diff recording tombstone on delete at t=200
    const afterDeleteDiff = diffAndStampCollection([entry], [], {}, 200);
    expect(afterDeleteDiff.tombstones.entries).toBeUndefined();
    expect(afterDeleteDiff.tombstones['e-1']).toBe(200);

    const { nextState, restoredRecord } = restoreTrashRecord({
      categories: [{ id: 'travail', label: 'Travail' }],
      entries: [],
      activities: [],
      activityTemplates: [],
      deletedItems: [trashRec],
    }, trashRec.id, { nowMs: 500 });

    expect(restoredRecord.id).toBe(trashRec.id);
    expect(nextState.entries).toHaveLength(1);
    expect(nextState.entries[0].id).toBe('e-1');
    expect(nextState.entries[0].updatedAt).toBe(500);
    expect(nextState.deletedItems).toHaveLength(0);

    // Subsequent CRDT diff clears tombstone because updatedAt=500 > tombTs=200
    const afterRestoreDiff = diffAndStampCollection([], nextState.entries, afterDeleteDiff.tombstones, 500);
    expect(afterRestoreDiff.tombstones['e-1']).toBeUndefined();
    expect(afterRestoreDiff.items).toHaveLength(1);
  });

  it('restores cascade-deleted categories, orphaned parents cleanly, and prior category assignments', () => {
    const parentCat = { id: 'cat-parent', label: 'Sport', color: '#5C7A5E', parentId: 'missing-grandparent' };
    const childCat = { id: 'cat-child', label: 'Course', color: '#5C7A5E', parentId: 'cat-parent' };
    const rec = createTrashRecord({
      kind: TRASH_ITEM_KINDS.CATEGORY,
      item: parentCat,
      related: {
        descendants: [childCat],
        reassignedEntryCategoryIds: { 'e-1': 'cat-child' },
        reassignedActivityCategoryIds: { 'a-1': 'cat-parent' },
      },
      deletedAt: 1000,
    });

    const { nextState } = restoreTrashRecord({
      categories: [{ id: 'autre', label: 'Autre', parentId: null }],
      entries: [{ id: 'e-1', activity: '10km', categoryId: null }],
      activities: [{ id: 'a-1', label: 'Gainage', categoryId: null }],
      activityTemplates: [],
      deletedItems: [rec],
    }, rec.id, { nowMs: 2000 });

    const restoredParent = nextState.categories.find(c => c.id === 'cat-parent');
    const restoredChild = nextState.categories.find(c => c.id === 'cat-child');
    expect(restoredParent).toBeTruthy();
    expect(restoredParent.parentId).toBeNull(); // detached missing ancestor safely
    expect(restoredChild?.parentId).toBe('cat-parent');
    expect(nextState.entries[0].categoryId).toBe('cat-child');
    expect(nextState.activities[0].categoryId).toBe('cat-parent');
  });
});

describe('stateManager trash / undelete reducer integration', () => {
  it('pushes deleted entries/activities/templates into deletedItems and restores or purges them', () => {
    const sm = createStateManager({
      initialState: {
        categories: [{ id: 'travail', label: 'Travail', parentId: null }],
        entries: [{ id: 'e-1', activity: 'Dev', categoryId: 'travail', date: '2026-11-23', start: '09:00', end: '10:00', mins: 60 }],
        activities: [{ id: 'a-1', label: 'Revue', categoryId: 'travail' }],
        activityTemplates: [{ id: 'tpl-1', name: 'Routine', steps: [{ id: 's1', activity: 'Dev', categoryId: 'travail' }] }],
      },
    });

    sm.actions.deleteEntry('e-1');
    sm.actions.deleteActivity('a-1');
    sm.actions.deleteTemplate('tpl-1');

    expect(sm.getState().entries).toHaveLength(0);
    expect(sm.getState().activities).toHaveLength(0);
    expect(sm.getState().activityTemplates).toHaveLength(0);
    expect(sm.getState().deletedItems).toHaveLength(3);

    // Restore last deleted (template)
    sm.actions.restoreLastDeleted();
    expect(sm.getState().activityTemplates).toHaveLength(1);
    expect(sm.getState().deletedItems).toHaveLength(2);

    // Restore specific entry by trash id
    const entryTrash = sm.getState().deletedItems.find(d => d.kind === TRASH_ITEM_KINDS.ENTRY);
    sm.actions.restoreDeletedItem(entryTrash.id);
    expect(sm.getState().entries).toHaveLength(1);
    expect(sm.getState().deletedItems).toHaveLength(1);

    // Purge remaining trash item
    const remainingId = sm.getState().deletedItems[0].id;
    sm.actions.purgeTrashItem(remainingId);
    expect(sm.getState().deletedItems).toHaveLength(0);

    // Empty trash helper
    sm.actions.deleteEntry('e-1');
    expect(sm.getState().deletedItems).toHaveLength(1);
    sm.actions.emptyTrash();
    expect(sm.getState().deletedItems).toHaveLength(0);
  });
});

describe('UI Undelete Toast & Corbeille integration', () => {
  beforeEach(() => {
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#entries';
  });

  it('restores a deleted entry immediately via instant Annuler toast button', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const stateManager = createStateManager({
      initialState: {
        tab: 'entries',
        categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
        entries: [
          { id: 'e-1', activity: 'Rédaction', categoryId: 'travail', date: '2026-11-23', start: '09:00', end: '10:00', mins: 60 },
        ],
      },
      persistFn: vi.fn().mockResolvedValue(undefined),
    });

    const ui = createUI({
      root,
      state: stateManager.getState(),
      stateManager,
      persist: vi.fn().mockResolvedValue(undefined),
    });

    root.querySelector('[data-behavior-target="entry-delete"]').click();
    await flushAsync();

    expect(stateManager.getState().entries).toHaveLength(0);
    expect(stateManager.getState().deletedItems).toHaveLength(1);

    const undoToastBtn = root.querySelector('.app-notice-toast [data-behavior-target="notice-undo-delete"]');
    expect(undoToastBtn).toBeTruthy();
    expect(undoToastBtn.textContent).toBe('Annuler');

    undoToastBtn.click();
    await flushAsync();

    expect(stateManager.getState().entries).toHaveLength(1);
    expect(stateManager.getState().entries[0].activity).toBe('Rédaction');
    expect(stateManager.getState().deletedItems).toHaveLength(0);

    ui.destroy();
    root.remove();
  });

  it('restores deleted activity, template, and category from Corbeille on #data page and supports Vider la corbeille', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    window.location.hash = '#categories';

    const stateManager = createStateManager({
      initialState: {
        tab: 'categories',
        categories: [
          ...DEFAULT_CATEGORIES.map(c => ({ ...c })),
          { id: 'custom-cat', label: 'Projets Perso', color: '#3F7068', parentId: null, builtin: false },
        ],
        entries: [
          { id: 'e-cat', activity: 'Side project', categoryId: 'custom-cat', date: '2026-11-23', start: '18:00', end: '19:00', mins: 60 },
        ],
        activities: [
          { id: 'a-1', label: 'Lecture technique', categoryId: 'etude', useCount: 2 },
        ],
        activityTemplates: [
          { id: 'tpl-1', name: 'Matin', steps: [{ id: 's1', activity: 'Lecture technique', categoryId: 'etude', targetMins: 20 }] },
        ],
      },
      persistFn: vi.fn().mockResolvedValue(undefined),
    });

    const ui = createUI({
      root,
      state: stateManager.getState(),
      stateManager,
      persist: vi.fn().mockResolvedValue(undefined),
    });

    // 1. Delete custom category via confirmation modal
    const deleteCatBtn = root.querySelector('.category-item-row[data-category-id="custom-cat"] [data-behavior-target="category-delete"]');
    expect(deleteCatBtn).toBeTruthy();
    deleteCatBtn.click();
    const confirmCatBtn = root.querySelector('[data-behavior-target="category-delete-confirm"]');
    expect(confirmCatBtn).toBeTruthy();
    confirmCatBtn.click();
    await flushAsync();

    expect(stateManager.getState().categories.some(c => c.id === 'custom-cat')).toBe(false);
    expect(stateManager.getState().entries[0].categoryId).toBeNull();
    expect(stateManager.getState().deletedItems).toHaveLength(1);

    // 2. Delete a saved activity on #activities
    root.querySelector('#nav-activities').click();
    root.querySelector('[data-behavior-target="activity-delete"]').click();
    await flushAsync();
    expect(stateManager.getState().activities).toHaveLength(0);

    // 3. Delete a template on #templates
    root.querySelector('#nav-templates').click();
    root.querySelector('[data-behavior-target="template-delete"]').click();
    await flushAsync();
    expect(stateManager.getState().activityTemplates).toHaveLength(0);
    expect(stateManager.getState().deletedItems).toHaveLength(3);

    // 4. Open Gestion des données (#data) and inspect Corbeille
    root.querySelector('#nav-data').click();
    expect(root.querySelector('[data-trash-card="true"]')).toBeTruthy();
    expect(root.querySelectorAll('.trash-row')).toHaveLength(3);

    // Restore the deleted category from Corbeille -> restores category AND re-associates entry!
    const catTrashRow = root.querySelector('.trash-row[data-trash-kind="category"]');
    expect(catTrashRow).toBeTruthy();
    catTrashRow.querySelector('[data-behavior-target="trash-restore"]').click();
    await flushAsync();

    expect(stateManager.getState().categories.some(c => c.id === 'custom-cat')).toBe(true);
    expect(stateManager.getState().entries[0].categoryId).toBe('custom-cat');
    expect(root.querySelectorAll('.trash-row')).toHaveLength(2);

    // Empty remaining items in trash
    root.querySelector('[data-behavior-target="trash-empty"]').click();
    await flushAsync();
    expect(stateManager.getState().deletedItems).toHaveLength(0);
    expect(root.querySelectorAll('.trash-row')).toHaveLength(0);

    ui.destroy();
    root.remove();
  });
});
