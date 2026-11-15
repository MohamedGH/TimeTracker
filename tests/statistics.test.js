import { describe, it, expect } from 'vitest';
import {
  filterEntriesByPeriod,
  aggregateCategoryBreakdown,
  aggregateTopActivities,
  calculateDashboardStats,
  formatDuration,
  PERIODS,
} from '../src/core/statistics.js';

describe('statistics', () => {
  const categories = [
    { id: 'travail', label: 'Travail', color: '#111', parentId: null },
    { id: 'dev', label: 'Développement', color: '#222', parentId: 'travail' },
    { id: 'sport', label: 'Sport', color: '#333', parentId: null },
  ];

  const entries = [
    { id: '1', activity: 'Frontend', categoryId: 'dev', date: '2026-09-28', start: '09:00', end: '11:00', mins: 120 },
    { id: '2', activity: 'Réunion', categoryId: 'travail', date: '2026-09-28', start: '14:00', end: '15:00', mins: 60 },
    { id: '3', activity: 'Course', categoryId: 'sport', date: '2026-09-27', start: '18:00', end: '18:45', mins: 45 },
    { id: '4', activity: 'Frontend', categoryId: 'dev', date: '2026-09-20', start: '09:00', end: '10:00', mins: 60 }, // older
  ];

  describe('formatDuration', () => {
    it('formats minutes, hours, and combinations', () => {
      expect(formatDuration(45)).toBe('45 min');
      expect(formatDuration(60)).toBe('1 h');
      expect(formatDuration(125)).toBe('2 h 05');
    });
  });

  describe('filterEntriesByPeriod', () => {
    it('filters for TODAY period', () => {
      const filtered = filterEntriesByPeriod(entries, PERIODS.TODAY, '2026-09-28');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(e => e.id)).toEqual(['1', '2']);
    });

    it('filters for 7 DAYS period', () => {
      const filtered = filterEntriesByPeriod(entries, PERIODS.DAYS_7, '2026-09-28');
      // 2026-09-28 down to 2026-09-22: includes 1, 2, 3 (not 4)
      expect(filtered).toHaveLength(3);
    });

    it('returns all entries for ALL period', () => {
      const filtered = filterEntriesByPeriod(entries, PERIODS.ALL, '2026-09-28');
      expect(filtered).toHaveLength(4);
    });
  });

  describe('aggregateCategoryBreakdown', () => {
    it('rolls up child category time into ancestor parent categories', () => {
      const breakdown = aggregateCategoryBreakdown(entries, categories);
      const travail = breakdown.find(c => c.id === 'travail');
      const dev = breakdown.find(c => c.id === 'dev');
      const sport = breakdown.find(c => c.id === 'sport');

      // dev has 120 + 60 = 180 min
      expect(dev.totalMins).toBe(180);

      // travail has direct 60 + child 180 = 240 min!
      expect(travail.totalMins).toBe(240);
      expect(travail.directMins).toBe(60);

      // sport has 45 min
      expect(sport.totalMins).toBe(45);

      // percentages should sum to 100% of roots
      expect(travail.percentage).toBeGreaterThan(dev.percentage);
    });
  });

  describe('aggregateTopActivities', () => {
    it('ranks activities by total time and frequency', () => {
      const top = aggregateTopActivities(entries, categories);
      expect(top[0].name).toBe('Frontend');
      expect(top[0].count).toBe(2);
      expect(top[0].totalMins).toBe(180);
      expect(top[0].categoryLabel).toBe('Développement');
    });
  });

  describe('calculateDashboardStats', () => {
    it('computes complete stats answering the core questions', () => {
      const stats = calculateDashboardStats(entries, categories, PERIODS.DAYS_7, '2026-09-28');

      expect(stats.totalMinutes).toBe(225); // 120 + 60 + 45
      expect(stats.todayMinutes).toBe(180); // 120 + 60
      expect(stats.activeDaysCount).toBe(2); // 2026-09-28 and 2026-09-27
      expect(stats.topCategories[0].id).toBe('travail');
      expect(stats.topActivities[0].name).toBe('Frontend');
    });
  });
});
