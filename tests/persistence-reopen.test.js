import { describe, it, expect, beforeEach } from 'vitest';
import { createAppState } from '../src/app-state.js';
import { createUI } from '../src/ui.js';
import { clearAllData } from '../src/core/storage.js';
import { today } from '../src/core/time.js';

describe('Persistence across app reopenings', () => {
  beforeEach(async () => {
    await clearAllData();
    window.location.hash = '#entry';
  });

  it('persists new activities and entries even after StateManager dispatches diverge object identity', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app1 = await createAppState();
    let deviceChangeCb = null;
    let currentProfile = { deviceType: 'mobile', navLayout: 'bottom-bar', shellClass: 'app-shell--mobile', navClass: 'mobile-bottom-nav', showFullLabels: false, showKeyboardHints: false };
    const ui1 = createUI({
      root,
      ...app1,
      deviceNavControllerFactory: ({ onChange } = {}) => {
        deviceChangeCb = onChange;
        return {
          getProfile: () => currentProfile,
          destroy: () => {},
        };
      },
    });

    // Trigger a StateManager action (like device resize or shortcut filter) so
    // stateManager.getState() becomes a new object distinct from `app1.state`.
    currentProfile = { deviceType: 'desktop', navLayout: 'side-rail', shellClass: 'app-shell--desktop', navClass: 'desktop-side-rail', showFullLabels: true, showKeyboardHints: true };
    deviceChangeCb?.(currentProfile);
    expect(app1.stateManager.getState()).not.toBe(app1.state);

    // 1. Add saved activities via the Activities page modal
    root.querySelector('#nav-activities')?.click();
    root.querySelector('[data-behavior-target="activity-add-open"]')?.click();
    const actForm = root.querySelector('[data-behavior-form="activity-form"]');
    expect(actForm).not.toBeNull();
    actForm.querySelector('[data-behavior-field="label"]').value = 'Révision';
    actForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));

    // Also save an activity whose name matches a category label (e.g. "Sport")
    root.querySelector('[data-behavior-target="activity-add-open"]')?.click();
    const actForm2 = root.querySelector('[data-behavior-form="activity-form"]');
    actForm2.querySelector('[data-behavior-field="label"]').value = 'Sport';
    actForm2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));

    // 2. Navigate to Chrono & Saisie and record a manual time entry
    root.querySelector('#nav-entry')?.click();
    root.querySelector('[data-behavior-target="entry-mode-manual"]')?.click();
    const entryForm = root.querySelector('[data-behavior-form="entry-form"]');
    expect(entryForm).not.toBeNull();
    entryForm.querySelector('[data-behavior-field="activity"]').value = 'Lecture technique';
    entryForm.querySelector('[data-behavior-field="date"]').value = today();
    entryForm.querySelector('[data-behavior-field="start"]').value = '09:00';
    entryForm.querySelector('[data-behavior-field="end"]').value = '10:30';
    entryForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));

    // 3. Start and stop the timer to record a second entry
    root.querySelector('[data-behavior-target="entry-mode-timer"]')?.click();
    const timerForm = root.querySelector('[data-behavior-form="entry-form"]');
    timerForm.querySelector('[data-behavior-field="activity"]').value = 'Révision';
    timerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));
    root.querySelector('[data-behavior-target="timer-stop"]')?.click();
    await new Promise(r => setTimeout(r, 40));

    ui1.destroy();
    root.remove();

    // 4. Reopen app from IndexedDB via createAppState()
    const app2 = await createAppState();

    expect(app2.state.activities.map(a => a.label)).toEqual(
      expect.arrayContaining(['Révision', 'Sport'])
    );
    expect(app2.state.entries.map(e => e.activity)).toEqual(
      expect.arrayContaining(['Lecture technique', 'Révision'])
    );
    expect(app2.state.entries.length).toBe(2);
    expect(app2.state.activeTimer).toBeNull();
  });
});
