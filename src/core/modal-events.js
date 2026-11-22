/**
 * Specialized module for modal DOM event isolation and modal-state detection.
 * Prevents clicks, pointer/touch gestures, and wheel events inside modals from
 * bubbling into background views or interactive D3.js charts.
 */

export const MODAL_ISOLATED_EVENT_TYPES = Object.freeze([
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'wheel',
]);

/**
 * Pure check returning whether a DOM document currently hosts an open modal overlay.
 */
export function hasOpenModal(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.querySelector !== 'function') return false;
  return Boolean(doc.querySelector('.modal-overlay'));
}

/**
 * Pure check returning whether a DOM event originated inside a modal overlay or box.
 */
export function isEventInsideModal(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('.modal-overlay, .modal-box'));
}

/**
 * Attaches non-bubbling event boundaries on a modal overlay and its content box.
 * - Stops propagation on all pointer, mouse, touch, click, and wheel events so
 *   background D3 charts / canvases / cards never receive leaked modal events.
 * - Protects backdrop clicks against drag-out gestures starting inside `.modal-box`.
 * - Prevents wheel scrolling on the `.modal-overlay` backdrop from scrolling the page.
 *
 * Returns a detach function.
 */
export function isolateModalEvents(overlay, box, { onBackdropClose = null } = {}) {
  const cleanups = [];
  let pointerDownStartedInBox = false;

  const stopOnly = (event) => {
    event.stopPropagation();
  };

  if (box && typeof box.addEventListener === 'function') {
    const markBoxStart = () => {
      pointerDownStartedInBox = true;
    };

    box.addEventListener('mousedown', markBoxStart);
    box.addEventListener('pointerdown', markBoxStart);
    box.addEventListener('touchstart', markBoxStart, { passive: true });
    cleanups.push(() => {
      box.removeEventListener('mousedown', markBoxStart);
      box.removeEventListener('pointerdown', markBoxStart);
      box.removeEventListener('touchstart', markBoxStart);
    });

    for (const eventType of MODAL_ISOLATED_EVENT_TYPES) {
      const options = eventType === 'wheel' || eventType === 'touchstart' || eventType === 'touchend'
        ? { passive: true }
        : undefined;
      box.addEventListener(eventType, stopOnly, options);
      cleanups.push(() => box.removeEventListener(eventType, stopOnly, options));
    }
  }

  if (overlay && typeof overlay.addEventListener === 'function') {
    const handleOverlayDown = (event) => {
      if (event.target === overlay) {
        pointerDownStartedInBox = false;
      }
      event.stopPropagation();
    };

    const handleOverlayWheel = (event) => {
      event.stopPropagation();
      if (event.target === overlay && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleOverlayClick = (event) => {
      event.stopPropagation();
      const startedInBox = pointerDownStartedInBox;
      pointerDownStartedInBox = false;
      if (!startedInBox && event.target === overlay) {
        onBackdropClose?.(event);
      }
    };

    for (const eventType of MODAL_ISOLATED_EVENT_TYPES) {
      if (eventType === 'click') {
        overlay.addEventListener('click', handleOverlayClick);
        cleanups.push(() => overlay.removeEventListener('click', handleOverlayClick));
      } else if (eventType === 'wheel') {
        overlay.addEventListener('wheel', handleOverlayWheel, { passive: false });
        cleanups.push(() => overlay.removeEventListener('wheel', handleOverlayWheel, { passive: false }));
      } else if (eventType === 'mousedown' || eventType === 'pointerdown' || eventType === 'touchstart') {
        const options = eventType === 'touchstart' ? { passive: true } : undefined;
        overlay.addEventListener(eventType, handleOverlayDown, options);
        cleanups.push(() => overlay.removeEventListener(eventType, handleOverlayDown, options));
      } else {
        const options = eventType === 'touchend' ? { passive: true } : undefined;
        overlay.addEventListener(eventType, stopOnly, options);
        cleanups.push(() => overlay.removeEventListener(eventType, stopOnly, options));
      }
    }
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
