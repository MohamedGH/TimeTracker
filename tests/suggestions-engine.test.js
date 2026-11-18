import { describe, it, expect } from 'vitest';
import {
  analyzeActivityCategory,
  getUsualCategoryForActivity,
  getRecentActivities,
  getFrequentActivities,
  generatePersonalizedSuggestions,
} from '../src/core/suggestions-engine.js';
import { createTimeEntry, updateTimeEntry } from '../src/core/time-entry.js';
import { timerToEntry, createActiveTimer } from '../src/core/timer.js';
import { normalizeEntries } from '../src/core/model.js';

describe('suggestions-engine & viaTimer model propagation', () => {
  const categories = [
    { id: 'travail', label: 'Travail' },
    { id: 'sport', label: 'Sport' },
    { id: 'loisirs', label: 'Loisirs' },
  ];

  const activities = [
    { id: 'act-1', label: 'Codage', categoryId: 'travail', useCount: 10 },
    { id: 'act-2', label: 'Course à pied', categoryId: 'sport', useCount: 5 },
  ];

  const entries = [
    { id: '1', activity: 'Codage', categoryId: 'travail', date: '2026-09-28', start: '09:00', end: '10:00', mins: 60 },
    { id: '2', activity: 'Codage', categoryId: 'travail', date: '2026-09-27', start: '09:30', end: '10:30', mins: 60 },
    { id: '3', activity: 'Course à pied', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '19:00', mins: 60 },
    { id: '4', activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-26', start: '21:00', end: '22:00', mins: 60 },
    { id: '5', activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-25', start: '21:15', end: '22:00', mins: 45 },
    { id: '6', activity: 'Douche', categoryId: 'sport', date: '2026-09-27', start: '19:00', end: '19:15', mins: 15 },
  ];

  describe('viaTimer propagation & legacy entry compatibility', () => {
    it('preserves viaTimer=false for manual creation and viaTimer=true for timer completion', () => {
      const manual = createTimeEntry({
        id: 'm1',
        activity: 'Revue',
        categoryId: 'travail',
        date: '2026-09-28',
        start: '10:00',
        end: '10:30',
        viaTimer: false,
      });
      expect(manual.viaTimer).toBe(false);

      const timer = createActiveTimer({
        activity: 'Codage',
        categoryId: 'travail',
        startTs: 1_000_000,
        startTime: '11:00',
        date: '2026-09-28',
      });
      const fromTimer = timerToEntry(timer, {
        id: 't1',
        endTime: '11:45',
        endTs: 1_000_000 + 45 * 60_000,
      });
      expect(fromTimer.viaTimer).toBe(true);
    });

    it('preserves viaTimer across edits and keeps legacy entries undefined', () => {
      const timerEntry = createTimeEntry({
        id: 't2',
        activity: 'Sprint',
        categoryId: 'travail',
        date: '2026-09-28',
        start: '14:00',
        end: '15:00',
        viaTimer: true,
      });
      const editedTimer = updateTimeEntry(timerEntry, { activity: 'Sprint planning' });
      expect(editedTimer.viaTimer).toBe(true);

      const legacyEntry = {
        id: 'leg-1',
        activity: 'Archive',
        categoryId: 'travail',
        date: '2026-09-20',
        start: '08:00',
        end: '09:00',
        mins: 60,
      };
      expect('viaTimer' in legacyEntry).toBe(false);
      const editedLegacy = updateTimeEntry(legacyEntry, { mins: 65 });
      expect(editedLegacy.viaTimer).toBeUndefined();

      const [normLegacy, normTimer] = normalizeEntries([legacyEntry, timerEntry]);
      expect(normLegacy.viaTimer).toBeUndefined();
      expect(normTimer.viaTimer).toBe(true);
    });

    it('does not misclassify legacy entries without viaTimer into manual mode observations', () => {
      const legacyOnly = Array.from({ length: 8 }, (_, idx) => ({
        id: `leg-${idx}`,
        activity: `Tâche ${idx}`,
        categoryId: 'travail',
        date: `2026-09-${String(20 + idx).padStart(2, '0')}`,
        start: '10:00',
        end: '11:00',
        mins: 60,
      }));

      const suggestions = generatePersonalizedSuggestions({
        entries: legacyOnly,
        activities,
        categories,
        currentHour: 15,
      });

      expect(suggestions.some(s => s.kind === 'usage_mode')).toBe(false);
    });

    it('surfaces timer/manual mode observation only when known-origin sample threshold is met', () => {
      const insufficientKnown = [
        { id: '1', activity: 'A', categoryId: 'travail', date: '2026-09-28', start: '09:00', end: '09:30', mins: 30, viaTimer: true },
        { id: '2', activity: 'B', categoryId: 'travail', date: '2026-09-27', start: '09:00', end: '09:30', mins: 30, viaTimer: true },
        { id: '3', activity: 'C', categoryId: 'travail', date: '2026-09-26', start: '09:00', end: '09:30', mins: 30, viaTimer: true },
      ];
      const suppressed = generatePersonalizedSuggestions({
        entries: insufficientKnown,
        activities,
        categories,
        currentHour: 14,
        minOriginSample: 5,
      });
      expect(suppressed.some(s => s.kind === 'usage_mode')).toBe(false);

      const sufficientTimer = [
        ...insufficientKnown,
        { id: '4', activity: 'D', categoryId: 'travail', date: '2026-09-25', start: '09:00', end: '09:30', mins: 30, viaTimer: true },
        { id: '5', activity: 'E', categoryId: 'travail', date: '2026-09-24', start: '09:00', end: '09:30', mins: 30, viaTimer: true },
        { id: '6', activity: 'F', categoryId: 'travail', date: '2026-09-23', start: '09:00', end: '09:30', mins: 30 }, // legacy ignored
      ];
      const timerObs = generatePersonalizedSuggestions({
        entries: sufficientTimer,
        activities,
        categories,
        currentHour: 14,
        minOriginSample: 5,
      });
      const modeItem = timerObs.find(s => s.kind === 'usage_mode');
      expect(modeItem).toBeTruthy();
      expect(modeItem.id).toBe('timer_usage_habit');
      expect(modeItem.occurrences).toBe(5);
      expect(modeItem.sessionCount).toBe(5);
      expect(modeItem.message).toContain('1 entrée ancienne sans origine exclue');
    });
  });

  describe('getUsualCategoryForActivity & ambiguity guards', () => {
    it('prioritizes saved activities over entry history', () => {
      const conflictingEntries = [
        { id: 'e1', activity: 'Codage', categoryId: 'loisirs', date: '2026-09-28', start: '10:00', end: '11:00', mins: 60 },
        { id: 'e2', activity: 'Codage', categoryId: 'loisirs', date: '2026-09-27', start: '10:00', end: '11:00', mins: 60 },
      ];
      expect(getUsualCategoryForActivity('codage', conflictingEntries, activities)).toBe('travail');
      expect(analyzeActivityCategory('Codage', conflictingEntries, activities).source).toBe('saved_activity');
    });

    it('finds dominant category from multi-occurrence history weighted by recency', () => {
      expect(getUsualCategoryForActivity('Lecture', entries, [])).toBe('loisirs');

      const shiftedEntries = [
        { id: '1', activity: 'Vélo', categoryId: 'sport', date: '2026-08-01', start: '10:00', end: '11:00', mins: 60 },
        { id: '2', activity: 'Vélo', categoryId: 'loisirs', date: '2026-09-27', start: '10:00', end: '11:00', mins: 60 },
        { id: '3', activity: 'Vélo', categoryId: 'loisirs', date: '2026-09-28', start: '10:00', end: '11:00', mins: 60 },
      ];
      expect(getUsualCategoryForActivity('Vélo', shiftedEntries, [])).toBe('loisirs');
    });

    it('never auto-assigns a category from a single ambiguous or tied event', () => {
      const ambiguousSingle = [
        { id: 'a1', activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-28', start: '21:00', end: '21:30', mins: 30 },
        { id: 'a2', activity: 'Lecture', categoryId: null, date: '2026-09-27', start: '21:00', end: '21:30', mins: 30 },
      ];
      expect(getUsualCategoryForActivity('Lecture', ambiguousSingle, [])).toBeNull();
      expect(analyzeActivityCategory('Lecture', ambiguousSingle, []).source).toBe('ambiguous');

      const tiedCategories = [
        { id: 't1', activity: 'Natation', categoryId: 'sport', date: '2026-09-28', start: '18:00', end: '19:00', mins: 60 },
        { id: 't2', activity: 'Natation', categoryId: 'loisirs', date: '2026-09-28', start: '19:00', end: '20:00', mins: 60 },
      ];
      expect(getUsualCategoryForActivity('Natation', tiedCategories, [])).toBeNull();
    });

    it('returns null if activity not found', () => {
      expect(getUsualCategoryForActivity('Unknown', entries, activities)).toBeNull();
    });
  });

  describe('getRecentActivities & getFrequentActivities', () => {
    it('returns ordered recent distinct activities', () => {
      const recent = getRecentActivities(entries, activities, 3);
      expect(recent[0].name).toBe('Codage');
      expect(recent.map(r => r.name)).toContain('Course à pied');
    });

    it('computes total/average durations, distinctDays and recency regularity score', () => {
      const freq = getFrequentActivities(entries, activities, 3, { recentDays: 30, referenceDate: '2026-09-28' });
      expect(freq[0].name).toBe('Codage');
      expect(freq[0].count).toBe(2);
      expect(freq[0].totalMins).toBe(120);
      expect(freq[0].avgMins).toBe(60);
      expect(freq[0].distinctDays).toBe(2);
      expect(freq[0].regularityScore).toBeGreaterThan(2);
    });
  });

  describe('generatePersonalizedSuggestions — time habits, midnight crossing & routines', () => {
    it('handles midnight crossing in time-of-day habits (23:30 and 00:15)', () => {
      const nightEntries = [
        { id: 'n1', activity: 'Journal du soir', categoryId: 'loisirs', date: '2026-09-26', start: '23:35', end: '23:55', mins: 20 },
        { id: 'n2', activity: 'Journal du soir', categoryId: 'loisirs', date: '2026-09-27', start: '00:15', end: '00:35', mins: 20 },
        { id: 'n3', activity: 'Journal du soir', categoryId: 'loisirs', date: '2026-09-28', start: '23:50', end: '23:59', mins: 9 },
      ];

      const atMidnight = generatePersonalizedSuggestions({
        entries: nightEntries,
        activities,
        categories,
        currentHour: 0,
        currentMinute: 5,
      });
      const midnightHabit = atMidnight.find(s => s.kind === 'time_habit');
      expect(midnightHabit).toBeTruthy();
      expect(midnightHabit.action?.activity).toBe('Journal du soir');
      expect(midnightHabit.occurrences).toBe(3);
      expect(midnightHabit.sessionCount).toBe(3);

      const at23h = generatePersonalizedSuggestions({
        entries: nightEntries,
        activities,
        categories,
        currentHour: 23,
        currentMinute: 50,
      });
      expect(at23h.find(s => s.kind === 'time_habit')?.action?.activity).toBe('Journal du soir');
    });

    it('ignores stale history outside recentDays and requires multi-day spread', () => {
      const stalePlusSameDay = [
        // 45 days old — outside 30-day window
        { id: 'old1', activity: 'Vieux projet', categoryId: 'travail', date: '2026-08-05', start: '09:00', end: '10:00', mins: 60 },
        { id: 'old2', activity: 'Vieux projet', categoryId: 'travail', date: '2026-08-06', start: '09:00', end: '10:00', mins: 60 },
        // Same single day burst today — coincidence, not multi-day habit
        { id: 's1', activity: 'Administratif', categoryId: 'travail', date: '2026-09-28', start: '09:00', end: '09:20', mins: 20 },
        { id: 's2', activity: 'Administratif', categoryId: 'travail', date: '2026-09-28', start: '09:25', end: '09:45', mins: 20 },
      ];

      const suggestions = generatePersonalizedSuggestions({
        entries: stalePlusSameDay,
        activities,
        categories,
        currentHour: 9,
        recentDays: 30,
        referenceDate: '2026-09-28',
      });

      expect(suggestions.some(s => s.kind === 'time_habit')).toBe(false);
    });

    it('detects repeated A -> B routine across multiple days after latest entry', () => {
      const routineEntries = [
        // Day 1: Course -> Douche (stored unsorted to verify chronological sort)
        { id: '1', activity: 'Douche', categoryId: 'sport', date: '2026-09-26', start: '19:05', end: '19:20', mins: 15 },
        { id: '2', activity: 'Course', categoryId: 'sport', date: '2026-09-26', start: '18:00', end: '19:00', mins: 60 },
        // Day 2: Course -> Douche
        { id: '3', activity: 'Course', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '19:00', mins: 60 },
        { id: '4', activity: 'Douche', categoryId: 'sport', date: '2026-09-27', start: '19:10', end: '19:25', mins: 15 },
        // Day 3 (latest session): Course just finished!
        { id: '5', activity: 'Course', categoryId: 'sport', date: '2026-09-28', start: '18:00', end: '19:00', mins: 60 },
      ];

      const suggestions = generatePersonalizedSuggestions({
        entries: routineEntries,
        activities,
        categories,
        currentHour: 19,
        currentMinute: 5,
      });

      const routine = suggestions.find(s => s.kind === 'routine');
      expect(routine).toBeTruthy();
      expect(routine.id).toBe('routine_course_to_douche');
      expect(routine.action?.activity).toBe('Douche');
      expect(routine.occurrences).toBe(2);
      expect(routine.sessionCount).toBe(2);
      expect(routine.type).toBe('hypothesis');
    });

    it('never confuses reversed B -> A sequence with A -> B routine', () => {
      const reversedEntries = [
        // Only Douche -> Course occurred twice; Course -> Douche never occurred
        { id: '1', activity: 'Douche', categoryId: 'sport', date: '2026-09-26', start: '17:40', end: '17:55', mins: 15 },
        { id: '2', activity: 'Course', categoryId: 'sport', date: '2026-09-26', start: '18:00', end: '19:00', mins: 60 },
        { id: '3', activity: 'Douche', categoryId: 'sport', date: '2026-09-27', start: '17:40', end: '17:55', mins: 15 },
        { id: '4', activity: 'Course', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '19:00', mins: 60 },
      ];

      const suggestions = generatePersonalizedSuggestions({
        entries: reversedEntries,
        activities,
        categories,
        currentHour: 19,
      });

      expect(suggestions.some(s => s.id === 'routine_course_to_douche')).toBe(false);
      const routine = suggestions.find(s => s.kind === 'routine');
      expect(routine?.id).toBe('routine_douche_to_course');
    });

    it('never links activities on different dates or large gaps or single occurrences into a routine', () => {
      const disjointDates = [
        // Day 1 morning Lecture, Day 2 afternoon Sport (different dates, gap > 90 mins)
        { id: 'd1', activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-24', start: '09:00', end: '10:00', mins: 60 },
        { id: 'd2', activity: 'Sport', categoryId: 'sport', date: '2026-09-25', start: '18:00', end: '19:00', mins: 60 },
        { id: 'd3', activity: 'Lecture', categoryId: 'loisirs', date: '2026-09-26', start: '09:00', end: '10:00', mins: 60 },
        { id: 'd4', activity: 'Sport', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '19:00', mins: 60 },
      ];

      const noCrossDayRoutine = generatePersonalizedSuggestions({
        entries: disjointDates,
        activities,
        categories,
        currentHour: 12,
      });
      expect(noCrossDayRoutine.some(s => s.kind === 'routine')).toBe(false);

      const singleOccurrence = [
        { id: 'o1', activity: 'Café', categoryId: 'loisirs', date: '2026-09-28', start: '08:00', end: '08:15', mins: 15 },
        { id: 'o2', activity: 'Emails', categoryId: 'travail', date: '2026-09-28', start: '08:20', end: '08:50', mins: 30 },
      ];
      const noSingleRoutine = generatePersonalizedSuggestions({
        entries: singleOccurrence,
        activities,
        categories,
        currentHour: 12,
      });
      expect(noSingleRoutine.some(s => s.kind === 'routine')).toBe(false);
    });

    it('includes full provenance and returns insufficient_data / no_trend states appropriately', () => {
      const empty = generatePersonalizedSuggestions({ entries: [], activities, categories, currentHour: 9 });
      expect(empty).toHaveLength(1);
      expect(empty[0].status).toBe('insufficient_data');
      expect(empty[0].rule).toBeTruthy();
      expect(empty[0].periodLabel).toBeTruthy();

      const varied = [
        { id: 'v1', activity: 'Alpha', categoryId: 'travail', date: '2026-09-26', start: '08:00', end: '08:30', mins: 30 },
        { id: 'v2', activity: 'Beta', categoryId: 'sport', date: '2026-09-27', start: '12:00', end: '12:30', mins: 30 },
        { id: 'v3', activity: 'Gamma', categoryId: 'loisirs', date: '2026-09-28', start: '20:00', end: '20:30', mins: 30 },
      ];
      const noTrend = generatePersonalizedSuggestions({
        entries: varied,
        activities,
        categories,
        currentHour: 15,
      });
      expect(noTrend).toHaveLength(1);
      expect(noTrend[0].status).toBe('no_trend');
      expect(noTrend[0].occurrences).toBe(3);

      const rich = generatePersonalizedSuggestions({
        entries,
        activities,
        categories,
        currentHour: 9,
      });
      for (const s of rich) {
        expect(s.engine).toBe('business');
        expect(['observation', 'hypothesis']).toContain(s.type);
        expect(s.rule).toBeTruthy();
        expect(Number.isFinite(s.occurrences)).toBe(true);
        expect(Number.isFinite(s.sessionCount)).toBe(true);
        expect(s.periodLabel).toBeTruthy();
        expect(s.confidence?.label).toBeTruthy();
      }
    });
  });
});
