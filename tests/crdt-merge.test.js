import { describe, it, expect } from 'vitest';
import {
  diffAndStampCollection,
  mergeCollectionLww,
  repairMergedCategoryTree,
  mergeSyncPayloads,
  serializeSyncPayload,
  parseSyncPayload,
} from '../src/core/sync/crdt-merge.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

describe('CRDT LWW + Tombstone sync merge', () => {
  it('stamps new/edited items and records tombstones for deleted items', () => {
    const prev = [
      { id: 'e1', activity: 'Code', mins: 30, updatedAt: 100 },
      { id: 'e2', activity: 'Sport', mins: 45, updatedAt: 100 },
    ];
    const next = [
      { id: 'e1', activity: 'Code', mins: 60, updatedAt: 100 }, // modified mins
      { id: 'e3', activity: 'Lecture', mins: 20 }, // new
    ];

    const diff = diffAndStampCollection(prev, next, {}, 500);
    expect(diff.items.find(x => x.id === 'e1').updatedAt).toBe(500);
    expect(diff.items.find(x => x.id === 'e3').updatedAt).toBe(500);
    expect(diff.tombstones).toEqual({ e2: 500 });
  });

  it('merges collections commutatively with LWW and tombstones', () => {
    const localItems = [
      { id: 'a1', label: 'Code', updatedAt: 200 },
      { id: 'a2', label: 'Design', updatedAt: 100 },
    ];
    const remoteItems = [
      { id: 'a1', label: 'Code Rust', updatedAt: 350 },
      { id: 'a3', label: 'Lecture', updatedAt: 300 },
    ];
    const localTombstones = { a3: 250 }; // older than remote edit 300 -> resurrected
    const remoteTombstones = { a2: 150 }; // newer than local 100 -> deleted

    const mergeAB = mergeCollectionLww(localItems, remoteItems, localTombstones, remoteTombstones);
    const mergeBA = mergeCollectionLww(remoteItems, localItems, remoteTombstones, localTombstones);

    expect(mergeAB.items).toEqual(mergeBA.items);
    expect(mergeAB.tombstones).toEqual(mergeBA.tombstones);
    expect(mergeAB.items.map(i => i.id)).toEqual(['a1', 'a3']);
    expect(mergeAB.items.find(i => i.id === 'a1').label).toBe('Code Rust');
    expect(mergeAB.tombstones).toEqual({ a2: 150 });
  });

  it('repairs concurrent category cycles and dangling parentIds after merge', () => {
    const categories = [
      ...DEFAULT_CATEGORIES.map(c => ({ ...c, updatedAt: 1 })),
      { id: 'c1', label: 'Cat 1', parentId: 'c2', updatedAt: 200 },
      { id: 'c2', label: 'Cat 2', parentId: 'c1', updatedAt: 200 },
      { id: 'c3', label: 'Cat 3', parentId: 'deleted-parent', updatedAt: 200 },
    ];

    const repaired = repairMergedCategoryTree(categories);
    const byId = new Map(repaired.map(c => [c.id, c]));
    expect(byId.get('c3').parentId).toBeNull();
    // Cycle between c1 and c2 must be broken
    expect(byId.get('c1').parentId === null || byId.get('c2').parentId === null).toBe(true);
  });

  it('merges full payloads losslessly across entries, activities, and categories', () => {
    const local = serializeSyncPayload({
      deviceId: 'dev-A',
      entries: [
        { id: 'e1', activity: 'Dev', categoryId: 'travail', date: '2026-11-15', start: '09:00', end: '10:00', mins: 60, updatedAt: 1000 },
      ],
      activities: [
        { id: 'act1', label: 'Dev', categoryId: 'travail', updatedAt: 1000 },
      ],
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c, updatedAt: 1 })),
    });

    const remote = serializeSyncPayload({
      deviceId: 'dev-B',
      entries: [
        { id: 'e2', activity: 'Course', categoryId: 'sport', date: '2026-11-15', start: '18:00', end: '18:45', mins: 45, updatedAt: 1200 },
      ],
      activities: [
        { id: 'act2', label: 'Course', categoryId: 'sport', updatedAt: 1200 },
      ],
      categories: [
        ...DEFAULT_CATEGORIES.map(c => ({ ...c, updatedAt: 1 })),
        { id: 'trail', label: 'Trail', parentId: 'sport', color: '#5C7A5E', updatedAt: 1200 },
      ],
    });

    const merged = mergeSyncPayloads(parseSyncPayload(local), parseSyncPayload(JSON.stringify(remote)));
    expect(merged.entries.map(e => e.id)).toEqual(['e2', 'e1']);
    expect(merged.activities.map(a => a.id).sort()).toEqual(['act1', 'act2']);
    expect(merged.categories.some(c => c.id === 'trail')).toBe(true);
  });
});
