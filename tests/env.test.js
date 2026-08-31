import { describe, it, expect, afterEach } from 'vitest';
import { getGa4MeasurementId } from '../src/core/analytics/env.js';

describe('getGa4MeasurementId', () => {
  afterEach(() => {
    delete window.__TIME_TRACKER_ENV__;
  });

  it('returns null when no measurement id is configured anywhere', () => {
    expect(getGa4MeasurementId()).toBeNull();
  });

  it('reads the runtime global used by the current unbundled deployment', () => {
    window.__TIME_TRACKER_ENV__ = { GA4_MEASUREMENT_ID: 'G-RUNTIME123' };
    expect(getGa4MeasurementId()).toBe('G-RUNTIME123');
  });

  it('ignores blank runtime values', () => {
    window.__TIME_TRACKER_ENV__ = { GA4_MEASUREMENT_ID: '   ' };
    expect(getGa4MeasurementId()).toBeNull();
  });

  it('trims the runtime value', () => {
    window.__TIME_TRACKER_ENV__ = { GA4_MEASUREMENT_ID: '  G-TRIM  ' };
    expect(getGa4MeasurementId()).toBe('G-TRIM');
  });
});
