import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUI } from '../src/ui.js';
import { createStateManager } from '../src/core/state-manager.js';
import {
  hasOpenModal,
  isEventInsideModal,
  isolateModalEvents,
  MODAL_ISOLATED_EVENT_TYPES,
} from '../src/core/modal-events.js';

function createSampleState(overrides = {}) {
  return {
    entries: [
      { id: 'e-1', activity: 'Code Frontend', categoryId: 'dev', date: '2026-11-20', start: '09:00', end: '10:00', mins: 60 },
    ],
    activities: [
      { id: 'act-1', label: 'Code Frontend', categoryId: 'dev', useCount: 3 },
    ],
    categories: [
      { id: 'travail', label: 'Travail', color: '#4A5A75', parentId: null, builtin: true },
      { id: 'dev', label: 'Développement', color: '#2980B9', parentId: 'travail', builtin: false },
      { id: 'sport', label: 'Sport', color: '#5C7A5E', parentId: null, builtin: true },
    ],
    activeTimer: null,
    timerUpdatedAt: 0,
    quickTilesConfig: null,
    authUser: null,
    tab: 'categories',
    period: '7',
    customStart: null,
    customEnd: null,
    editingEntryId: null,
    modal: null,
    error: null,
    notice: null,
    ...overrides,
  };
}

describe('Modal event isolation & D3 focus protection', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.localStorage.setItem('time-analytics-consent', 'false');
    window.location.hash = '#categories';
  });

  it('detects open modals and stops propagation of click/pointer/mouse/wheel events from modal-box and modal-overlay', () => {
    const parent = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    const insideBtn = document.createElement('button');
    insideBtn.textContent = 'Enregistrer';
    box.appendChild(insideBtn);
    overlay.appendChild(box);
    parent.appendChild(overlay);
    document.body.appendChild(parent);

    expect(hasOpenModal(document)).toBe(true);

    const leakedEvents = [];
    for (const evType of MODAL_ISOLATED_EVENT_TYPES) {
      parent.addEventListener(evType, () => leakedEvents.push(evType));
    }

    const onBackdropClose = vi.fn();
    const detach = isolateModalEvents(overlay, box, { onBackdropClose });

    // Inside box events must not bubble to parent or trigger backdrop close
    for (const evType of MODAL_ISOLATED_EVENT_TYPES) {
      const ev = evType === 'wheel'
        ? new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
        : new MouseEvent(evType, { bubbles: true, cancelable: true });
      expect(isEventInsideModal(ev)).toBe(false); // target is null until dispatched
      insideBtn.dispatchEvent(ev);
      expect(isEventInsideModal(ev)).toBe(true);
    }
    expect(leakedEvents).toEqual([]);
    expect(onBackdropClose).not.toHaveBeenCalled();

    // Dragging from inside box out onto overlay must NOT trigger backdrop close
    insideBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onBackdropClose).not.toHaveBeenCalled();
    expect(leakedEvents).toEqual([]);

    // Direct backdrop click closes modal and does not bubble to parent
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onBackdropClose).toHaveBeenCalledTimes(1);
    expect(leakedEvents).toEqual([]);

    // Wheel directly on overlay backdrop is prevented and does not bubble
    const overlayWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    overlay.dispatchEvent(overlayWheel);
    expect(overlayWheel.defaultPrevented).toBe(true);
    expect(leakedEvents).toEqual([]);

    detach();
  });

  it('prevents clicks and wheel events inside Edit Activity modal from bubbling to root/main/D3 chart and completes edit cleanly', async () => {
    const state = createSampleState({ tab: 'categories' });
    const stateManager = createStateManager(state);
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const persist = vi.fn().mockResolvedValue(undefined);
    const ui = createUI({ root, state, stateManager, persist });
    ui.render();

    // Open Edit Activity modal by clicking (✎) on the D3 tree activity node
    const editBtn = root.querySelector('g.tree-node[data-node-id="activity:act-1"] [data-action="edit-activity"]');
    expect(editBtn).toBeTruthy();
    editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const overlay = root.querySelector('.modal-overlay');
    const modalBox = root.querySelector('.modal-box');
    const main = root.querySelector('main');
    const chartStage = root.querySelector('.cat-tree-stage');
    const zoomLayer = root.querySelector('.cat-tree-zoom-layer');

    expect(overlay).toBeTruthy();
    expect(modalBox).toBeTruthy();
    expect(root.classList.contains('has-modal')).toBe(true);
    expect(main.getAttribute('aria-hidden')).toBe('true');
    if ('inert' in main) {
      expect(main.inert).toBe(true);
    }
    expect(chartStage.dataset.chartFocused).toBe('false');

    // Track if any event inside modal bubbles out to root or D3 svg
    const rootLeaked = [];
    for (const evType of ['click', 'dblclick', 'mousedown', 'pointerdown', 'wheel']) {
      root.addEventListener(evType, () => rootLeaked.push(evType));
    }

    const labelInput = modalBox.querySelector('input[data-behavior-field="label"]');
    expect(labelInput.value).toBe('Code Frontend');

    const initialChartTransform = zoomLayer.getAttribute('transform');

    // Interact heavily inside the Edit Activity modal
    labelInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    labelInput.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    modalBox.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));

    // Also interact with the enhanced category selector inside the modal
    const categorySubSelect = modalBox.querySelector('.category-selector-chain select');
    expect(categorySubSelect).toBeTruthy();
    categorySubSelect.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    categorySubSelect.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(rootLeaked).toEqual([]);
    expect(zoomLayer.getAttribute('transform')).toBe(initialChartTransform);
    expect(chartStage.dataset.chartFocused).toBe('false');

    // Update label and submit form
    labelInput.value = 'Code Frontend v2';
    const form = modalBox.querySelector('form[data-behavior-form="activity-form"]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(root.querySelector('.modal-overlay')).toBeNull();
    });

    expect(state.activities[0].label).toBe('Code Frontend v2');
    expect(root.classList.contains('has-modal')).toBe(false);
    const updatedMain = root.querySelector('main');
    expect(updatedMain.getAttribute('aria-hidden')).toBe('false');
    if ('inert' in updatedMain) {
      expect(updatedMain.inert).toBe(false);
    }

    ui.destroy();
  });
});
