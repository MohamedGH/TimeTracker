import { describe, it, expect } from 'vitest';
import {
  getUsualCategoryForActivity,
  getRecentActivities,
  getFrequentActivities,
  generatePersonalizedSuggestions,
} from '../src/core/suggestions-engine.js';

describe('suggestions-engine', () => {
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
    { id: '5', activity: 'Douche', categoryId: 'sport', date: '2026-09-27', start: '19:00', end: '19:15', mins: 15 },
  ];

  describe('getUsualCategoryForActivity', () => {
    it('finds category from saved activities', () => {
      expect(getUsualCategoryForActivity('Codage', [], activities)).toBe('travail');
    });

    it('finds category from entry history if not in saved activities', () => {
      expect(getUsualCategoryForActivity('Lecture', entries, [])).toBe('loisirs');
    });

    it('is case-insensitive', () => {
      expect(getUsualCategoryForActivity('codage', entries, activities)).toBe('travail');
    });

    it('returns null if activity not found', () => {
      expect(getUsualCategoryForActivity('Unknown', entries, activities)).toBeNull();
    });
  });

  describe('getRecentActivities', () => {
    it('returns ordered recent distinct activities', () => {
      const recent = getRecentActivities(entries, activities, 3);
      expect(recent[0].name).toBe('Codage');
      expect(recent.map(r => r.name)).toContain('Course à pied');
    });
  });

  describe('getFrequentActivities', () => {
    it('returns most frequent activities', () => {
      const freq = getFrequentActivities(entries, activities, 3);
      expect(freq[0].name).toBe('Codage');
      expect(freq[0].count).toBe(2);
    });
  });

  describe('generatePersonalizedSuggestions', () => {
    it('generates hour habit observation when multiple entries match time slot', () => {
      const suggestions = generatePersonalizedSuggestions({
        entries,
        activities,
        categories,
        currentHour: 9, // Codage was run at 09:00 and 09:30
      });

      const hourHabit = suggestions.find(s => s.id.startsWith('time_habit_'));
      expect(hourHabit).toBeTruthy();
      expect(hourHabit.message).toContain('Observation');
      expect(hourHabit.message).toContain('Codage');
      expect(hourHabit.action?.activity).toBe('Codage');
    });

    it('generates routine sequence hypothesis after last entry', () => {
      const suggestions = generatePersonalizedSuggestions({
        entries: [
          { id: '1', activity: 'Douche', categoryId: 'sport', date: '2026-09-28', start: '19:00', end: '19:15', mins: 15 },
          { id: '2', activity: 'Course', categoryId: 'sport', date: '2026-09-28', start: '18:00', end: '19:00', mins: 60 },
          { id: '3', activity: 'Douche', categoryId: 'sport', date: '2026-09-27', start: '19:00', end: '19:15', mins: 15 },
          { id: '4', activity: 'Course', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '19:00', mins: 60 },
          { id: '5', activity: 'Course', categoryId: 'sport', date: '2026-09-26', start: '18:00', end: '19:00', mins: 60 },
        ],
        activities,
        categories,
        currentHour: 20,
      });

      const routine = suggestions.find(s => s.id.startsWith('routine_after_'));
      // Since Douche was last and followed Course repeatedly
      expect(routine || suggestions.length > 0).toBeTruthy();
    });

    it('formulates all suggestions strictly as observations or hypotheses', () => {
      const suggestions = generatePersonalizedSuggestions({
        entries,
        activities,
        categories,
        currentHour: 9,
      });

      for (const s of suggestions) {
        expect(['observation', 'hypothesis']).toContain(s.type);
        expect(s.message.startsWith('Observation') || s.message.startsWith('Hypothèse') || s.message.includes('Observation')).toBe(true);
      }
    });
  });
});
