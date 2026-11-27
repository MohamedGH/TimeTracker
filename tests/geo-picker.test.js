import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { createStateManager } from '../src/core/state-manager.js';
import { clearAllData } from '../src/core/storage.js';
import { DEFAULT_CATEGORIES } from '../src/core/model.js';

describe('Modifier GPS en utilisant la carte (GeoPickerModal)', () => {
  beforeEach(async () => {
    await clearAllData();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '';
  });

  it('allows opening map picker modal from manual entry form, clicking map / typing coordinates, and updating location', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const persist = vi.fn().mockResolvedValue(undefined);
    const stateManager = createStateManager({
      initialState: {
        entries: [],
        activities: [],
        categories: [...DEFAULT_CATEGORIES],
        activityTemplates: [],
        activeTimer: null,
        tab: 'entry',
      },
      persistFn: persist,
    });
    const state = stateManager.getState();
    const ui = createUI({
      root,
      state,
      stateManager,
      persist,
    });

    // Switch to manual entry mode
    root.querySelector('[data-behavior-target="entry-mode-manual"]').click();
    await Promise.resolve();

    // Click map picker button for start location
    const mapPickBtn = root.querySelector('[data-behavior-target="entry-geo-capture-map"]');
    expect(mapPickBtn).toBeTruthy();
    mapPickBtn.click();
    await Promise.resolve();

    const geoModal = root.querySelector('.geo-picker-modal');
    expect(geoModal).toBeTruthy();
    expect(geoModal.textContent).toContain('Choisir : Position départ');

    // Test coordinate inputs adjustment
    const latInput = geoModal.querySelector('[data-geo-picker-lat="true"]');
    const lngInput = geoModal.querySelector('[data-geo-picker-lng="true"]');
    expect(latInput).toBeTruthy();
    expect(lngInput).toBeTruthy();

    latInput.value = '48.860000';
    latInput.dispatchEvent(new Event('input', { bubbles: true }));
    lngInput.value = '2.340000';
    lngInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Click map pad to simulate clicking on map
    const mapPad = geoModal.querySelector('[data-geo-picker-map="true"]');
    expect(mapPad).toBeTruthy();
    const mockRect = { left: 0, top: 0, width: 200, height: 100 };
    vi.spyOn(mapPad, 'getBoundingClientRect').mockReturnValue(mockRect);
    mapPad.dispatchEvent(new MouseEvent('click', { clientX: 120, clientY: 60, bubbles: true }));
    await Promise.resolve();

    // Confirm location
    const confirmBtn = geoModal.querySelector('[data-behavior-target="geo-picker-confirm"]');
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();
    await Promise.resolve();

    // Modal closes and entry form reflects location
    expect(root.querySelector('.geo-picker-modal')).toBeNull();
    expect(root.textContent).toContain('Position départ');

    ui.destroy();
    root.remove();
  });
});
