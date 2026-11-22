import { describe, it, expect } from 'vitest';
import {
  normalizeTemplateStep,
  normalizeActivityTemplate,
  normalizeTemplatesList,
  normalizeActiveTemplateRun,
  validateActivityTemplate,
  reorderTemplateSteps,
  saveActivityTemplate,
  deleteActivityTemplate,
  recordTemplateUse,
  buildTemplateFromEntries,
  collectEntrySequencesByDate,
  detectRecurringSequences,
  startTemplateRun,
  advanceTemplateRun,
  pauseTemplateRunAfterManualStop,
  resumeReadyTemplateRun,
  computeTemplateRunProgress,
  buildEntriesFromTemplate,
  reassignCategoryInTemplates,
  reassignActivityInTemplates,
} from '../src/state/template-actions.js';
import { createStateManager } from '../src/core/state-manager.js';
import { normalizeError, ERROR_CODES } from '../src/core/error-manager.js';
import { mergeSyncPayloads, serializeSyncPayload, parseSyncPayload } from '../src/core/sync/crdt-merge.js';
import { buildExportPayload, parseImportPayload } from '../src/core/import-export.js';

const CATEGORIES = [
  { id: 'transport', label: 'Transport', color: '#8B93A1', parentId: null, builtin: true },
  { id: 'spiritualite', label: 'Spiritualité', color: '#5C7A5E', parentId: null, builtin: false },
  { id: 'etude', label: 'Étude', color: '#3F7068', parentId: null, builtin: true },
];

describe('template-actions pure domain logic', () => {
  it('validates template drafts (empty name, empty steps, blank step activity, valid)', () => {
    expect(validateActivityTemplate({ name: '   ', steps: [{ activity: 'A' }] })).toMatchObject({
      valid: false,
      error: 'Veuillez donner un nom au gabarit.',
    });

    expect(validateActivityTemplate({ name: 'Mosquée', steps: [] })).toMatchObject({
      valid: false,
      error: 'Ajoutez au moins une étape au gabarit.',
    });

    expect(validateActivityTemplate({ name: 'Mosquée', steps: [{ activity: 'Mosquée trajet' }, { activity: '   ' }] })).toMatchObject({
      valid: false,
      error: 'Chaque étape du gabarit doit contenir un nom d’activité.',
    });

    const ok = validateActivityTemplate({
      name: '  Mosquée  ',
      steps: [
        { activity: ' Mosquée trajet ', categoryId: 'transport', targetMins: 15 },
        { activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
        { activity: 'Mosquée doha', categoryId: 'etude', targetMins: 15 },
      ],
    });
    expect(ok.valid).toBe(true);
    expect(ok.normalizedName).toBe('Mosquée');
    expect(ok.normalizedSteps).toHaveLength(3);
  });

  it('saves, updates, reorders steps, records usage, and deletes templates cleanly without mutating inputs', () => {
    const initial = [];
    const created = saveActivityTemplate(
      initial,
      {
        name: 'Routine Mosquée',
        steps: [
          { activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
          { activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
          { activity: 'Mosquée doha', categoryId: 'etude', targetMins: 15 },
        ],
      },
      CATEGORIES,
      1000
    );

    expect(initial).toHaveLength(0);
    expect(created.isEdit).toBe(false);
    expect(created.templates).toHaveLength(1);
    expect(created.template.steps.map(s => s.activity)).toEqual([
      'Mosquée trajet',
      'Mosquée prière',
      'Mosquée doha',
    ]);

    const reorderedSteps = reorderTemplateSteps(created.template.steps, 2, 0);
    expect(reorderedSteps.map(s => s.activity)).toEqual([
      'Mosquée doha',
      'Mosquée trajet',
      'Mosquée prière',
    ]);

    const updated = saveActivityTemplate(
      created.templates,
      {
        id: created.template.id,
        name: 'Mosquée Matin',
        steps: reorderedSteps,
      },
      CATEGORIES,
      2000
    );
    expect(updated.isEdit).toBe(true);
    expect(updated.templates).toHaveLength(1);
    expect(updated.template.name).toBe('Mosquée Matin');

    const used = recordTemplateUse(updated.templates, created.template.id, 3000);
    expect(used[0].useCount).toBe(1);
    expect(used[0].lastUsedAt).toBe(new Date(3000).toISOString());

    const afterDelete = deleteActivityTemplate(used, created.template.id);
    expect(afterDelete).toHaveLength(0);
  });

  it('extracts a template chronologically from unordered recorded entries (mosquée trajet -> prière -> doha)', () => {
    // Entries are stored reverse-chronologically in app state
    const entries = [
      { id: 'e3', activity: 'Mosquée doha', categoryId: 'etude', date: '2026-11-21', start: '08:40', end: '08:55', mins: 15 },
      { id: 'e1', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-21', start: '08:05', end: '08:20', mins: 15 },
      { id: 'e2', activity: 'Mosquée prière', categoryId: 'spiritualite', date: '2026-11-21', start: '08:20', end: '08:40', mins: 20 },
    ];

    const built = buildTemplateFromEntries({
      entries,
      categories: CATEGORIES,
      includeDurations: true,
    });

    expect(built.name).toBe('Mosquée trajet → Mosquée prière → Mosquée doha');
    expect(built.steps.map(s => s.activity)).toEqual([
      'Mosquée trajet',
      'Mosquée prière',
      'Mosquée doha',
    ]);
    expect(built.steps.map(s => s.targetMins)).toEqual([15, 20, 15]);
    expect(built.steps.map(s => s.categoryId)).toEqual(['transport', 'spiritualite', 'etude']);
  });

  it('collapses consecutive duplicate entries when requested during extraction', () => {
    const entries = [
      { id: 'e1', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-21', start: '08:00', end: '08:10', mins: 10 },
      { id: 'e2', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-21', start: '08:10', end: '08:15', mins: 5 },
      { id: 'e3', activity: 'Mosquée prière', categoryId: 'spiritualite', date: '2026-11-21', start: '08:15', end: '08:35', mins: 20 },
    ];

    const built = buildTemplateFromEntries({
      entries,
      categories: CATEGORIES,
      collapseConsecutiveDuplicates: true,
    });
    expect(built.steps).toHaveLength(2);
    expect(built.steps[0].activity).toBe('Mosquée trajet');
    expect(built.steps[0].targetMins).toBe(15);
  });

  it('groups recorded sessions by date chronologically and detects recurring sequences', () => {
    const entries = [
      // Day 1
      { id: '1', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-20', start: '08:00', end: '08:15', mins: 15 },
      { id: '2', activity: 'Mosquée prière', categoryId: 'spiritualite', date: '2026-11-20', start: '08:15', end: '08:35', mins: 20 },
      { id: '3', activity: 'Mosquée doha', categoryId: 'etude', date: '2026-11-20', start: '08:35', end: '08:50', mins: 15 },
      // Day 2 (stored out of chronological order)
      { id: '6', activity: 'Mosquée doha', categoryId: 'etude', date: '2026-11-21', start: '08:40', end: '09:00', mins: 20 },
      { id: '5', activity: 'Mosquée prière', categoryId: 'spiritualite', date: '2026-11-21', start: '08:15', end: '08:40', mins: 25 },
      { id: '4', activity: 'Mosquée trajet', categoryId: 'transport', date: '2026-11-21', start: '08:00', end: '08:15', mins: 15 },
      { id: '7', activity: 'Travail', categoryId: null, date: '2026-11-21', start: '09:30', end: '11:30', mins: 120 },
    ];

    const byDate = collectEntrySequencesByDate(entries);
    expect(byDate.map(d => d.date)).toEqual(['2026-11-21', '2026-11-20']);
    expect(byDate[0].entries.map(e => e.activity)).toEqual([
      'Mosquée trajet',
      'Mosquée prière',
      'Mosquée doha',
      'Travail',
    ]);

    const recurring = detectRecurringSequences(entries);
    expect(recurring.length).toBeGreaterThanOrEqual(1);
    expect(recurring[0].suggestedName).toBe('Mosquée trajet → Mosquée prière → Mosquée doha');
    expect(recurring[0].occurrences).toBe(2);
    expect(recurring[0].steps.map(s => s.targetMins)).toEqual([15, 23, 18]);
  });

  it('runs template steps sequentially: start -> advance -> pause -> resume -> complete', () => {
    const template = normalizeActivityTemplate({
      id: 'tpl-1',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
        { id: 's3', activity: 'Mosquée doha', categoryId: 'etude', targetMins: 15 },
      ],
    }, CATEGORIES);

    const started = startTemplateRun(template);
    expect(started.firstStep.activity).toBe('Mosquée trajet');
    expect(computeTemplateRunProgress(started.run)).toMatchObject({
      stepNumber: 1,
      totalSteps: 3,
      isLastStep: false,
      nextStep: { activity: 'Mosquée prière' },
    });

    const step2 = advanceTemplateRun(started.run, { recordedStep: true });
    expect(step2.completed).toBe(false);
    expect(step2.nextStep.activity).toBe('Mosquée prière');
    expect(step2.nextRun.completedEntriesCount).toBe(1);

    // Pause via direct stop timer -> prepares step 3 ('ready')
    const paused = pauseTemplateRunAfterManualStop(step2.nextRun);
    expect(paused).toMatchObject({
      currentIndex: 2,
      stepState: 'ready',
      completedEntriesCount: 2,
    });

    const resumed = resumeReadyTemplateRun(paused);
    expect(resumed.currentStep.activity).toBe('Mosquée doha');
    expect(resumed.nextRun.stepState).toBe('running');

    const done = advanceTemplateRun(resumed.nextRun, { recordedStep: true });
    expect(done.completed).toBe(true);
    expect(done.nextRun).toBeNull();
    expect(done.totalCompleted).toBe(3);
  });

  it('builds consecutive time entries for manual logging of a template', () => {
    const template = normalizeActivityTemplate({
      id: 'tpl-1',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
        { id: 's3', activity: 'Mosquée doha', categoryId: 'etude', targetMins: null },
      ],
    }, CATEGORIES);

    const created = buildEntriesFromTemplate(template, {
      date: '2026-11-22',
      startTime: '08:00',
      fallbackMins: 10,
    });

    expect(created).toHaveLength(3);
    expect(created.map(e => `${e.start}-${e.end} ${e.activity} (${e.mins})`)).toEqual([
      '08:00-08:15 Mosquée trajet (15)',
      '08:15-08:35 Mosquée prière (20)',
      '08:35-08:45 Mosquée doha (10)',
    ]);
  });

  it('reassigns categories and activities inside templates cleanly', () => {
    const templates = [
      normalizeActivityTemplate({
        id: 't1',
        name: 'Mosquée',
        steps: [
          { id: 's1', activity: 'Trajet', categoryId: 'transport' },
          { id: 's2', activity: 'Prière', categoryId: 'spiritualite' },
        ],
      }),
    ];

    const afterCatMerge = reassignCategoryInTemplates(templates, 'transport', 'etude');
    expect(afterCatMerge[0].steps[0].categoryId).toBe('etude');

    const afterActMerge = reassignActivityInTemplates(
      afterCatMerge,
      { label: 'Trajet', categoryId: 'etude' },
      { label: 'Mosquée trajet', categoryId: 'transport' }
    );
    expect(afterActMerge[0].steps[0].activity).toBe('Mosquée trajet');
    expect(afterActMerge[0].steps[0].categoryId).toBe('transport');
  });
});

describe('Template integration with StateManager, ErrorManager, Export/Import & CRDT Sync', () => {
  it('preserves template validation errors verbatim in ErrorManager', () => {
    const formatted = normalizeError(new Error('Ajoutez au moins une étape au gabarit.'), 'template');
    expect(formatted.code).toBe(ERROR_CODES.VALIDATION);
    expect(formatted.message).toBe('Ajoutez au moins une étape au gabarit.');
  });

  it('handles full template lifecycle actions inside StateManager', () => {
    const persistFn = () => Promise.resolve();
    const sm = createStateManager({
      initialState: { categories: CATEGORIES, entries: [], activities: [] },
      persistFn,
    });

    sm.actions.saveTemplate({
      id: 'tpl-mosque',
      name: 'Mosquée',
      steps: [
        { activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 10 },
        { activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
      ],
    });
    expect(sm.getState().activityTemplates).toHaveLength(1);

    const tpl = sm.getState().activityTemplates[0];
    sm.actions.startTemplateRun({ template: tpl, date: '2026-11-22', startTime: '08:00', startTs: 1000 });
    expect(sm.getState().activeTimer.activity).toBe('Mosquée trajet');
    expect(sm.getState().activeTemplateRun.currentIndex).toBe(0);

    sm.actions.advanceTemplateRun({ recordCurrent: true, date: '2026-11-22', startTime: '08:10', end: '08:10', nowTs: 601000 });
    expect(sm.getState().entries).toHaveLength(1);
    expect(sm.getState().activeTimer.activity).toBe('Mosquée prière');
    expect(sm.getState().activeTemplateRun.currentIndex).toBe(1);

    sm.actions.advanceTemplateRun({ recordCurrent: true, date: '2026-11-22', startTime: '08:30', end: '08:30', nowTs: 1801000 });
    expect(sm.getState().entries).toHaveLength(2);
    expect(sm.getState().activeTimer).toBeNull();
    expect(sm.getState().activeTemplateRun).toBeNull();

    sm.actions.logTemplateEntries({ template: tpl, date: '2026-11-21', startTime: '07:00' });
    expect(sm.getState().entries).toHaveLength(4);

    sm.actions.deleteTemplate('tpl-mosque');
    expect(sm.getState().activityTemplates).toHaveLength(0);
  });

  it('round-trips activityTemplates through Export/Import and CRDT Sync LWW merge', () => {
    const tpl = normalizeActivityTemplate({
      id: 'tpl-sync-1',
      name: 'Mosquée',
      steps: [
        { id: 's1', activity: 'Mosquée trajet', categoryId: 'transport', targetMins: 15 },
        { id: 's2', activity: 'Mosquée prière', categoryId: 'spiritualite', targetMins: 20 },
      ],
      updatedAt: 500,
    }, CATEGORIES);

    const exported = buildExportPayload({
      entries: [],
      savedActivities: [],
      categories: CATEGORIES,
      activityTemplates: [tpl],
    });
    const imported = parseImportPayload(JSON.stringify(exported));
    expect(imported.activityTemplates).toHaveLength(1);
    expect(imported.activityTemplates[0].name).toBe('Mosquée');

    // CRDT merge: remote updates template, local has older copy
    const localSync = serializeSyncPayload({
      categories: CATEGORIES,
      templates: [tpl],
      deviceId: 'dev-a',
    });
    const remoteRaw = serializeSyncPayload({
      categories: CATEGORIES,
      templates: [{ ...tpl, name: 'Mosquée Complète', updatedAt: 900 }],
      deviceId: 'dev-b',
    });
    const merged = mergeSyncPayloads(parseSyncPayload(localSync), parseSyncPayload(remoteRaw));
    expect(merged.templates).toHaveLength(1);
    expect(merged.templates[0].name).toBe('Mosquée Complète');

    // Edge normalization checks
    expect(normalizeTemplateStep({ activity: '' }).activity).toBe('');
    expect(normalizeTemplatesList([null, { id: 'bad', name: '', steps: [] }])).toEqual([]);
    expect(normalizeActiveTemplateRun(null)).toBeNull();
  });
});
