import test from 'node:test';
import assert from 'node:assert/strict';

import { createTimeEntry, updateTimeEntry, isTimeEntry } from '../src/core/time-entry.ts';
import { createActiveTimer, elapsedSeconds, elapsedMinutes } from '../src/core/timer.ts';
import {
  createCategory,
  getChildren,
  getRoots,
  getAncestors,
  getDescendants,
  wouldCreateCycle,
  formatCategoryPath,
  validateCategoryTree,
} from '../src/core/category-tree.js';
import { isDate, isTime } from '../src/core/validation.js';
import { buildExportPayload, parseImportPayload } from '../src/core/import-export.js';
import { addCategory, renameCategory, moveCategory, deleteCategory } from '../src/state/category-actions.ts';

test('TimeEntry - creation and validation', () => {
  const entry = createTimeEntry({
    id: 'e1',
    activity: '   Code review   ',
    categoryId: 'travail',
    date: '2026-08-26',
    start: '09:00',
    end: '10:30',
  });

  assert.equal(entry.id, 'e1');
  assert.equal(entry.activity, 'Code review');
  assert.equal(entry.categoryId, 'travail');
  assert.equal(entry.mins, 90);
  assert.equal(isTimeEntry(entry), true);

  const updated = updateTimeEntry(entry, { start: '09:00', end: '11:00', mins: undefined });
  assert.equal(updated.mins, 120);
});

test('Timer - active timer calculation', () => {
  const now = Date.now();
  const timer = createActiveTimer({
    activity: 'Meeting',
    categoryId: 'travail',
    startTs: now - 120000,
    startTime: '10:00',
    date: '2026-08-26',
  });

  assert.equal(timer.activity, 'Meeting');
  assert.equal(elapsedSeconds(timer, now), 120);
  assert.equal(elapsedMinutes(timer, now), 2);
});

test('CategoryTree - hierarchy and path resolution', () => {
  const c1 = createCategory({ id: 'root1', label: 'Root 1' });
  const c2 = createCategory({ id: 'sub1', label: 'Sub 1', parentId: 'root1' });
  const c3 = createCategory({ id: 'sub2', label: 'Sub 2', parentId: 'sub1' });
  const tree = [c1, c2, c3];

  assert.equal(validateCategoryTree(tree), true);
  assert.deepEqual(getRoots(tree), [c1]);
  assert.deepEqual(getChildren(tree, 'root1'), [c2]);
  assert.deepEqual(getAncestors(tree, 'sub2'), [c1, c2]);
  assert.deepEqual(getDescendants(tree, 'root1'), [c2, c3]);
  assert.equal(formatCategoryPath(tree, 'sub2'), 'Root 1 > Sub 1 > Sub 2');
  assert.equal(wouldCreateCycle(tree, 'root1', 'sub2'), true);
  assert.equal(wouldCreateCycle(tree, 'sub2', 'root1'), false);
});

test('CategoryActions - add, rename, move and delete', () => {
  let categories = [
    { id: 'cat1', label: 'Work', parentId: null, builtin: false },
    { id: 'cat2', label: 'Personal', parentId: null, builtin: false },
  ];

  categories = addCategory(categories, { id: 'cat1-1', label: 'Projects', parentId: 'cat1' });
  assert.equal(categories.length, 3);

  categories = renameCategory(categories, 'cat1-1', 'Active Projects');
  assert.equal(categories.find(c => c.id === 'cat1-1').label, 'Active Projects');

  categories = moveCategory(categories, 'cat1-1', 'cat2');
  assert.equal(categories.find(c => c.id === 'cat1-1').parentId, 'cat2');

  assert.throws(() => moveCategory(categories, 'cat2', 'cat1-1'), /boucle/);

  categories = deleteCategory(categories, 'cat2', { cascade: true });
  assert.equal(categories.length, 1);
  assert.equal(categories[0].id, 'cat1');
});

test('Validation & Import-Export', () => {
  assert.equal(isDate('2026-08-26'), true);
  assert.equal(isDate('2026-13-40'), false);
  assert.equal(isTime('14:30'), true);
  assert.equal(isTime('25:61'), false);

  const exportData = buildExportPayload({
    entries: [createTimeEntry({ id: 'e1', activity: 'Dev', categoryId: 'cat1', date: '2026-08-26', start: '10:00', end: '11:00' })],
    savedActivities: [{ id: 'a1', label: 'Dev', categoryId: 'cat1' }],
    categories: [{ id: 'cat1', label: 'Work', parentId: null }],
  });

  const parsed = parseImportPayload(JSON.stringify(exportData));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.categories.filter(c => !c.builtin).length, 1);
});
